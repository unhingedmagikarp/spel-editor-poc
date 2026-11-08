import type {
  BinaryNode,
  FunctionCallNode,
  IndexNode,
  MemberNode,
  MethodCallNode,
  Node,
  ProjectionNode,
  SelectionNode,
  TernaryNode,
  VariableNode,
} from './ast';
import { arityMessage, findMethod, findProperty, methodsOf, propertiesOf, type ResolvedProperty } from './members';
import { describeType, t, type SpelType, type TemplateSchema } from './schema';
import { suggest } from './suggest';
import { diagnostic, own, type QuickFix, type Severity, type Span, type SpelDiagnostic } from './types';

const replaceWith = (label: string, from: number, to: number, insert: string): QuickFix => ({ label, from, to, insert });

interface Finding {
  readonly message: string;
  readonly fix?: QuickFix;
}

/** "… Did you mean 'x'?" plus a fix that swaps in the suggestion. */
function withSuggestion(message: string, name: string, candidates: readonly string[], span: Span, prefix = ''): Finding {
  const hit = suggest(name, candidates);
  if (!hit) return { message };
  return {
    message: `${message} Did you mean '${prefix}${hit}'?`,
    fix: replaceWith(`Change to ${prefix}${hit}`, span.from, span.to, `${prefix}${hit}`),
  };
}

/** Marker spliced in at the cursor so the checker can report "what fits here" for autocomplete. */
export const CURSOR = '$$CURSOR$$';

export type CompletionContext =
  | { readonly kind: 'member'; readonly receiver: SpelType; readonly partial: string }
  | { readonly kind: 'reference'; readonly thisType: SpelType; readonly partial: string }
  | { readonly kind: 'variable'; readonly thisType: SpelType; readonly partial: string };

export interface TypeInfo {
  readonly type: SpelType;
  readonly nullable: boolean;
  readonly property?: ResolvedProperty;
}

export interface CheckResult {
  readonly diagnostics: readonly SpelDiagnostic[];
  readonly result: TypeInfo;
  readonly completion: CompletionContext | null;
}

interface Scope {
  readonly thisType: SpelType;
  readonly rootType: SpelType;
}

const UNKNOWN: TypeInfo = { type: t.unknown, nullable: false };
const known = (type: SpelType, nullable = false): TypeInfo => ({ type, nullable });
const NON_BOOLEAN_KINDS: ReadonlySet<SpelType['kind']> = new Set(['string', 'number', 'date', 'object', 'list']);

export function checkExpression(ast: Node, schema: TemplateSchema): CheckResult {
  return new Checker(schema).run(ast);
}

class Checker {
  private readonly diagnostics: SpelDiagnostic[] = [];
  private completion: CompletionContext | null = null;

  constructor(private readonly schema: TemplateSchema) {}

  run(ast: Node): CheckResult {
    const rootType = t.object(this.schema.rootType);
    const result = this.visit(ast, { thisType: rootType, rootType });
    return { diagnostics: this.diagnostics, result, completion: this.completion };
  }

  private report(severity: Severity, message: string, from: number, to: number, fix?: QuickFix): void {
    this.diagnostics.push(diagnostic(severity, message, from, to, fix));
  }

  private visit(node: Node, scope: Scope): TypeInfo {
    switch (node.type) {
      case 'literal':
        return literalType(node.value);
      case 'member':
        return this.member(node, scope);
      case 'methodCall':
        return this.methodCall(node, scope);
      case 'variable':
        return this.variable(node, scope);
      case 'functionCall':
        return this.functionCall(node, scope);
      case 'index':
        return this.index(node, scope);
      case 'selection':
        return this.selection(node, scope);
      case 'projection':
        return this.projection(node, scope);
      case 'unary': {
        const arg = this.visit(node.argument, scope);
        if (node.operator !== '!') return known(t.number);
        this.expectBoolean(arg, node.argument, "'!' (not) needs a true/false value");
        return known(t.boolean);
      }
      case 'binary':
        return this.binary(node, scope);
      case 'ternary':
        return this.ternary(node, scope);
      case 'elvis': {
        const left = this.visit(node.left, scope);
        const right = this.visit(node.right, scope);
        return known(left.type.kind === 'unknown' || left.type.kind === 'null' ? right.type : left.type, right.nullable);
      }
      case 'list': {
        const elements = node.elements.map((element) => this.visit(element, scope));
        return known(t.list(elements[0]?.type ?? t.unknown));
      }
      case 'map':
        node.entries.forEach((entry) => this.visit(entry.value, scope));
        return UNKNOWN;
      case 'typeRef':
      case 'constructor':
      case 'beanRef':
        if (node.type === 'constructor') node.args.forEach((a) => this.visit(a, scope));
        this.report('info', "The preview can't run this part (Java types / beans). The server can — double-check it there.", node.from, node.to);
        return UNKNOWN;
      case 'assign':
        this.visit(node.value, scope);
        this.report('error', "A single '=' would overwrite the value. To compare, use '=='.", node.operatorFrom, node.operatorTo,
          replaceWith("Use '=='", node.operatorFrom, node.operatorTo, '=='));
        return UNKNOWN;
      case 'missing':
        return UNKNOWN;
    }
  }

  // ---- property / method access -------------------------------------------

  private receiverOf(node: { readonly object: Node | null }, scope: Scope): TypeInfo {
    return node.object ? this.visit(node.object, scope) : known(scope.thisType);
  }

  private captureCompletion(node: MemberNode | MethodCallNode, receiver: TypeInfo, scope: Scope): boolean {
    if (!node.name.includes(CURSOR)) return false;
    const partial = node.name.replace(CURSOR, '');
    this.completion = node.object
      ? { kind: 'member', receiver: receiver.type, partial }
      : { kind: 'reference', thisType: scope.thisType, partial };
    return true;
  }

  private warnIfNullable(receiver: TypeInfo, node: MemberNode | MethodCallNode | SelectionNode | ProjectionNode): void {
    if (!node.object || node.safe || !receiver.nullable) return;
    const what = receiver.property ? `'${receiver.property.name}'` : 'This value';
    const isAccess = node.type === 'member' || node.type === 'methodCall';
    const next = isAccess ? `${node.name}${node.type === 'methodCall' ? '()' : ''}` : '?[…]';
    // The span between the object and the name holds the `.` we swap for `?.`.
    const dotTo = isAccess ? node.nameFrom : node.openFrom;
    this.report(
      'warning',
      `${what} can be empty for some customers, and then this fails. Write ${receiver.property?.name ?? '…'}?.${next} instead (add ?: for a fallback).`,
      node.object.to,
      isAccess ? node.nameTo : node.openTo,
      replaceWith("Use '?.'", node.object.to, dotTo, '?.'),
    );
  }

  private member(node: MemberNode, scope: Scope): TypeInfo {
    const receiver = this.receiverOf(node, scope);
    if (this.captureCompletion(node, receiver, scope)) return UNKNOWN;
    this.warnIfNullable(receiver, node);
    if (receiver.type.kind === 'unknown') return UNKNOWN;
    const prop = findProperty(receiver.type, node.name, this.schema);
    if (prop) return { type: prop.type, nullable: prop.nullable || (node.safe && receiver.nullable), property: prop };
    const finding = this.unknownProperty(receiver.type, node, scope);
    this.report('error', finding.message, node.nameFrom, node.nameTo, finding.fix);
    return UNKNOWN;
  }

  private unknownProperty(receiver: SpelType, node: MemberNode, scope: Scope): Finding {
    const name = node.name;
    const span = { from: node.nameFrom, to: node.nameTo };
    if (findMethod(receiver, name)) {
      return { message: `'${name}' is a method — write ${name}().`, fix: replaceWith('Add ()', span.from, span.to, `${name}()`) };
    }
    if (!node.object && scope.thisType !== scope.rootType && findProperty(scope.rootType, name, this.schema)) {
      return {
        message: `Inside a filter, names refer to each item (${describeType(scope.thisType)}). To use '${name}' from the message, write #root.${name}.`,
        fix: replaceWith(`Use #root.${name}`, span.from, span.to, `#root.${name}`),
      };
    }
    if (receiver.kind === 'list') {
      return {
        message: `This is a list, so it has no field '${name}'. Use [0].${name} for the first item, or .![${name}] to get it from every item.`,
      };
    }
    const candidates = propertiesOf(receiver, this.schema).map((prop) => prop.name);
    return withSuggestion(`${capitalize(describeType(receiver))} has no field '${name}'.`, name, candidates, span);
  }

  private methodCall(node: MethodCallNode, scope: Scope): TypeInfo {
    const receiver = this.receiverOf(node, scope);
    if (this.captureCompletion(node, receiver, scope)) return UNKNOWN;
    this.warnIfNullable(receiver, node);
    node.args.forEach((a) => this.visit(a, scope));
    if (receiver.type.kind === 'unknown') return UNKNOWN;
    const method = findMethod(receiver.type, node.name);
    if (!method) {
      const span = { from: node.nameFrom, to: node.nameTo };
      const finding: Finding = findProperty(receiver.type, node.name, this.schema)
        ? {
            message: `'${node.name}' is a field, not a method — remove the ().`,
            ...(node.args.length === 0 ? { fix: replaceWith('Remove ()', node.nameFrom, node.to, node.name) } : {}),
          }
        : withSuggestion(
            `${capitalize(describeType(receiver.type))} has no method '${node.name}()'.`,
            node.name,
            methodsOf(receiver.type).map((m) => m.name),
            span,
          );
      this.report('error', finding.message, span.from, span.to, finding.fix);
      return UNKNOWN;
    }
    const arity = arityMessage(node.name, method.params, node.args.length);
    if (arity) this.report('error', arity, node.nameFrom, node.to);
    return known(method.returns, node.safe && receiver.nullable);
  }

  private variable(node: VariableNode, scope: Scope): TypeInfo {
    if (node.name.includes(CURSOR) || node.name === '') {
      this.completion = { kind: 'variable', thisType: scope.thisType, partial: node.name.replace(CURSOR, '') };
      return UNKNOWN;
    }
    if (node.name === 'this') return known(scope.thisType);
    if (node.name === 'root') return known(scope.rootType);
    const def = own(this.schema.variables, node.name);
    if (def) return known(def.type, def.nullable ?? false);
    if (own(this.schema.functions, node.name)) {
      this.report('error', `'#${node.name}' is a function — call it with brackets: #${node.name}(…).`, node.from, node.to);
      return UNKNOWN;
    }
    const candidates = ['this', 'root', ...Object.keys(this.schema.variables)];
    const finding = withSuggestion(`Unknown variable '#${node.name}'.`, node.name, candidates, node, '#');
    this.report('error', finding.message, node.from, node.to, finding.fix);
    return UNKNOWN;
  }

  private functionCall(node: FunctionCallNode, scope: Scope): TypeInfo {
    node.args.forEach((a) => this.visit(a, scope));
    if (node.name.includes(CURSOR)) {
      this.completion = { kind: 'variable', thisType: scope.thisType, partial: node.name.replace(CURSOR, '') };
      return UNKNOWN;
    }
    const def = own(this.schema.functions, node.name);
    if (!def) {
      const span = { from: node.from, to: node.nameTo };
      const finding = withSuggestion(`Unknown function '#${node.name}()'.`, node.name, Object.keys(this.schema.functions), span, '#');
      this.report('error', finding.message, span.from, span.to, finding.fix);
      return UNKNOWN;
    }
    const arity = arityMessage(`#${node.name}`, def.params, node.args.length);
    if (arity) this.report('error', arity, node.from, node.to);
    return known(def.returns);
  }

  private index(node: IndexNode, scope: Scope): TypeInfo {
    const receiver = this.receiverOf(node, scope);
    this.visit(node.index, scope);
    switch (receiver.type.kind) {
      case 'list':
        return known(receiver.type.element);
      case 'string':
        return known(t.string);
      case 'object': {
        const key = node.index.type === 'literal' && typeof node.index.value === 'string' ? node.index.value : null;
        const prop = key ? findProperty(receiver.type, key, this.schema) : undefined;
        return prop ? { type: prop.type, nullable: prop.nullable, property: prop } : UNKNOWN;
      }
      default:
        return UNKNOWN;
    }
  }

  private iterable(node: SelectionNode | ProjectionNode, scope: Scope, label: string): SpelType | null {
    const receiver = this.receiverOf(node, scope);
    this.warnIfNullable(receiver, node);
    if (receiver.type.kind === 'list') return receiver.type.element;
    if (receiver.type.kind !== 'unknown') {
      this.report('error', `${label} only works on lists, but this is ${describeType(receiver.type)}.`, node.openFrom, node.openTo);
    }
    return null;
  }

  private selection(node: SelectionNode, scope: Scope): TypeInfo {
    const element = this.iterable(node, scope, `Filtering with '${node.mode === 'all' ? '?[' : node.mode === 'first' ? '^[' : '$['}'`);
    const predicate = this.visit(node.predicate, { ...scope, thisType: element ?? t.unknown });
    this.expectBoolean(predicate, node.predicate, 'The filter must be a true/false check, e.g. price > 10');
    if (!element) return UNKNOWN;
    return node.mode === 'all' ? known(t.list(element)) : known(element, true);
  }

  private projection(node: ProjectionNode, scope: Scope): TypeInfo {
    const element = this.iterable(node, scope, "Collecting with '![…]'");
    const result = this.visit(node.expression, { ...scope, thisType: element ?? t.unknown });
    return element ? known(t.list(result.type)) : UNKNOWN;
  }

  // ---- operators -------------------------------------------------------------

  private expectBoolean(info: TypeInfo, node: Node, message: string): void {
    if (NON_BOOLEAN_KINDS.has(info.type.kind)) {
      this.report('error', `${message} — but this is ${describeType(info.type)}.`, node.from, node.to);
    }
  }

  private binary(node: BinaryNode, scope: Scope): TypeInfo {
    const left = this.visit(node.left, scope);
    const right = this.visit(node.right, scope);
    switch (node.operator) {
      case '+':
        if (left.type.kind === 'string' || right.type.kind === 'string') return known(t.string);
        if (left.type.kind === 'number' && right.type.kind === 'number') return known(t.number);
        return UNKNOWN;
      case '-':
      case '*':
      case '/':
      case '%':
      case '^':
        return known(t.number);
      case 'and':
      case 'or':
        this.expectBoolean(left, node.left, `'${node.operator}' needs true/false on both sides`);
        this.expectBoolean(right, node.right, `'${node.operator}' needs true/false on both sides`);
        return known(t.boolean);
      case '==':
      case '!=':
        this.checkEnumComparison(left, node.right);
        this.checkEnumComparison(right, node.left);
        this.checkComparableKinds(left, right, node);
        return known(t.boolean);
      case '<':
      case '<=':
      case '>':
      case '>=':
        this.checkComparableKinds(left, right, node);
        return known(t.boolean);
      default:
        return known(t.boolean);
    }
  }

  private checkEnumComparison(side: TypeInfo, other: Node): void {
    const values = side.property?.enumValues;
    if (!values || other.type !== 'literal' || typeof other.value !== 'string') return;
    if (values.includes(other.value)) return;
    const literal = other.value;
    const caseMatch = values.find((value) => value.toLowerCase() === literal.toLowerCase());
    const message = caseMatch
      ? `'${literal}' will never match — values are case-sensitive. Use '${caseMatch}'.`
      : `'${literal}' is not a known value for '${side.property?.name}'. Expected one of: ${values.join(', ')}.`;
    const fix = caseMatch ? replaceWith(`Change to '${caseMatch}'`, other.from, other.to, `'${caseMatch}'`) : undefined;
    this.report('warning', message, other.from, other.to, fix);
  }

  private checkComparableKinds(left: TypeInfo, right: TypeInfo, node: BinaryNode): void {
    const kinds = new Set([left.type.kind, right.type.kind]);
    if (kinds.has('string') && kinds.has('number')) {
      this.report('warning', 'This compares text with a number, which is never equal — remove the quotes around the number?', node.from, node.to);
    }
  }

  private ternary(node: TernaryNode, scope: Scope): TypeInfo {
    const test = this.visit(node.test, scope);
    this.expectBoolean(test, node.test, "The part before '?' must be a true/false check, e.g. customer.tier == 'GOLD'");
    const yes = this.visit(node.consequent, scope);
    const no = this.visit(node.alternate, scope);
    const type =
      yes.type.kind === no.type.kind ? yes.type : yes.type.kind === 'null' ? no.type : no.type.kind === 'null' ? yes.type : t.unknown;
    return known(type, yes.nullable || no.nullable || yes.type.kind === 'null' || no.type.kind === 'null');
  }
}

function literalType(value: string | number | boolean | null): TypeInfo {
  if (value === null) return known(t.null, true);
  if (typeof value === 'string') return known(t.string);
  if (typeof value === 'number') return known(t.number);
  return known(t.boolean);
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
