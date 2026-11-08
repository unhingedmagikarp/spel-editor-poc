import type {
  FunctionCallNode,
  IndexNode,
  MemberNode,
  MethodCallNode,
  Node,
  ProjectionNode,
  SelectionNode,
} from './ast';
import { builtinMethodsForValue, DATE_PROPERTIES } from './builtins';
import { applyBinary } from './operators';
import type { TemplateSchema } from './schema';
import { own, type Span, type SpelRecord, type SpelValue } from './types';
import {
  describeValue,
  EvalFailure,
  expectBoolean,
  expectInteger,
  expectNumber,
  isList,
  isRecord,
  type FailureKind,
} from './values';

export interface EvalEnv {
  readonly root: SpelValue;
  readonly schema: TemplateSchema;
  readonly variables: Readonly<Record<string, SpelValue>>;
  /** Full template text, used to quote the user's own code in error messages. */
  readonly source: string;
}

export type EvalOutcome =
  | { readonly ok: true; readonly value: SpelValue }
  | { readonly ok: false; readonly kind: FailureKind; readonly message: string; readonly from: number; readonly to: number };

/** Called for every node that finished evaluating — powers the inspector panel. */
export type TraceFn = (node: Node, value: SpelValue) => void;

export function evaluate(ast: Node, env: EvalEnv, trace?: TraceFn): EvalOutcome {
  try {
    return { ok: true, value: new Interpreter(env, trace).eval(ast, env.root) };
  } catch (error: unknown) {
    if (error instanceof EvalFailure) {
      const span: Span = error.span ?? ast;
      return { ok: false, kind: error.kind, message: error.message, from: span.from, to: span.to };
    }
    const message = error instanceof Error ? error.message : 'Unexpected preview error';
    return { ok: false, kind: 'unsupported', message, from: ast.from, to: ast.to };
  }
}

class Interpreter {
  constructor(
    private readonly env: EvalEnv,
    private readonly trace: TraceFn | undefined,
  ) {}

  eval(node: Node, self: SpelValue): SpelValue {
    try {
      const value = this.evalNode(node, self);
      this.trace?.(node, value);
      return value;
    } catch (error: unknown) {
      if (error instanceof EvalFailure) throw error.withSpan(node);
      throw error;
    }
  }

  private text(node: Node | null): string {
    return node ? this.env.source.slice(node.from, node.to).trim() : 'the current item';
  }

  private evalNode(node: Node, self: SpelValue): SpelValue {
    switch (node.type) {
      case 'literal':
        return node.value;
      case 'member':
        return this.member(node, self);
      case 'methodCall':
        return this.methodCall(node, self);
      case 'variable':
        if (node.name === 'this') return self;
        if (node.name === 'root') return this.env.root;
        return own(this.env.variables, node.name) ?? null; // Spring yields null for unknown variables
      case 'functionCall':
        return this.functionCall(node, self);
      case 'index':
        return this.index(node, self);
      case 'selection':
        return this.selection(node, self);
      case 'projection':
        return this.projection(node, self);
      case 'unary': {
        const value = this.eval(node.argument, self);
        if (node.operator === '!') return !expectBoolean(value, `'${this.text(node.argument)}'`);
        const n = expectNumber(value, `'${this.text(node.argument)}'`);
        return node.operator === '-' ? -n : n;
      }
      case 'binary':
        return this.binary(node.operator, node.left, node.right, self);
      case 'ternary': {
        const test = this.eval(node.test, self);
        const condition = expectBoolean(test, `The condition '${this.text(node.test)}'`);
        return this.eval(condition ? node.consequent : node.alternate, self);
      }
      case 'elvis': {
        const left = this.eval(node.left, self);
        return left === null || left === '' ? this.eval(node.right, self) : left;
      }
      case 'list':
        return node.elements.map((element) => this.eval(element, self));
      case 'map':
        return Object.fromEntries(node.entries.map((entry) => [entry.key, this.eval(entry.value, self)]));
      case 'typeRef':
      case 'constructor':
      case 'beanRef':
        throw new EvalFailure("The preview can't run Java types or beans — check this one on the server.", 'unsupported');
      case 'assign':
        throw new EvalFailure("A single '=' would overwrite the value. To compare, use '=='.");
      case 'missing':
        throw new EvalFailure('Incomplete expression.', 'unsupported');
    }
  }

  private binary(operator: Parameters<typeof applyBinary>[0], left: Node, right: Node, self: SpelValue): SpelValue {
    if (operator === 'and' || operator === 'or') {
      const l = expectBoolean(this.eval(left, self), `The left side of '${operator}' ('${this.text(left)}')`);
      if (operator === 'and' && !l) return false;
      if (operator === 'or' && l) return true;
      return expectBoolean(this.eval(right, self), `The right side of '${operator}' ('${this.text(right)}')`);
    }
    return applyBinary(operator, this.eval(left, self), this.eval(right, self));
  }

  private target(node: { readonly object: Node | null }, self: SpelValue): SpelValue {
    return node.object ? this.eval(node.object, self) : self;
  }

  private member(node: MemberNode, self: SpelValue): SpelValue {
    const target = this.target(node, self);
    const span = { from: node.nameFrom, to: node.nameTo };
    if (target === null) {
      if (node.safe) return null;
      throw new EvalFailure(`Can't read '${node.name}' because ${this.text(node.object)} is empty for this sample.`, 'error', span);
    }
    if (target instanceof Date) {
      const prop = own(DATE_PROPERTIES, node.name);
      if (prop) return prop.get(target);
    }
    if (isRecord(target) && Object.hasOwn(target, node.name)) return target[node.name] ?? null;
    throw new EvalFailure(`There is no field '${node.name}' on ${describeValue(target)}.`, 'error', span);
  }

  private methodCall(node: MethodCallNode, self: SpelValue): SpelValue {
    const target = this.target(node, self);
    const span = { from: node.nameFrom, to: node.to };
    if (target === null) {
      if (node.safe) return null;
      throw new EvalFailure(`Can't call ${node.name}() because ${this.text(node.object)} is empty for this sample.`, 'error', span);
    }
    const method = own(builtinMethodsForValue(target), node.name);
    if (!method) throw new EvalFailure(`${node.name}() isn't available on ${describeValue(target)}.`, 'error', span);
    const args = node.args.map((a) => this.eval(a, self));
    try {
      return method.impl(target, args);
    } catch (error: unknown) {
      if (error instanceof EvalFailure) throw error.withSpan(span);
      throw error;
    }
  }

  private functionCall(node: FunctionCallNode, self: SpelValue): SpelValue {
    const def = own(this.env.schema.functions, node.name);
    if (!def) throw new EvalFailure(`Unknown function '#${node.name}()'.`);
    if (!def.preview) throw new EvalFailure(`The preview can't run #${node.name}() — it only runs on the server.`, 'unsupported');
    const args = node.args.map((a) => this.eval(a, self));
    try {
      return def.preview(args);
    } catch (error: unknown) {
      if (error instanceof EvalFailure) throw error;
      const reason = error instanceof Error ? error.message : 'unknown error';
      throw new EvalFailure(`#${node.name}() failed: ${reason}`);
    }
  }

  private index(node: IndexNode, self: SpelValue): SpelValue {
    const target = this.target(node, self);
    const key = this.eval(node.index, self);
    if (target === null) throw new EvalFailure(`Can't look inside ${this.text(node.object)} because it is empty.`);
    if (isList(target) || typeof target === 'string') {
      const i = expectInteger(key, 'The position');
      if (i < 0 || i >= target.length) {
        throw new EvalFailure(`There is no item ${i} — ${this.text(node.object)} has ${target.length}.`);
      }
      return (isList(target) ? target[i] : target.charAt(i)) ?? null;
    }
    if (isRecord(target) && typeof key === 'string') return lookup(target, key);
    throw new EvalFailure(`Can't use [ ] on ${describeValue(target)}.`);
  }

  private items(node: SelectionNode | ProjectionNode, self: SpelValue): readonly SpelValue[] | null {
    const target = this.target(node, self);
    if (target === null) {
      if (node.safe) return null;
      throw new EvalFailure(`Can't go through ${this.text(node.object)} because it is empty.`);
    }
    if (!isList(target)) throw new EvalFailure(`Only lists can be filtered, but this is ${describeValue(target)}.`);
    return target;
  }

  private selection(node: SelectionNode, self: SpelValue): SpelValue {
    const items = this.items(node, self);
    if (items === null) return null;
    const keep = items.filter((item) =>
      expectBoolean(this.eval(node.predicate, item), `The filter '${this.text(node.predicate)}'`),
    );
    if (node.mode === 'first') return keep[0] ?? null;
    if (node.mode === 'last') return keep.at(-1) ?? null;
    return keep;
  }

  private projection(node: ProjectionNode, self: SpelValue): SpelValue {
    const items = this.items(node, self);
    return items === null ? null : items.map((item) => this.eval(node.expression, item));
  }
}

function lookup(record: SpelRecord, key: string): SpelValue {
  if (!Object.hasOwn(record, key)) throw new EvalFailure(`There is no field '${key}'.`);
  return record[key] ?? null;
}
