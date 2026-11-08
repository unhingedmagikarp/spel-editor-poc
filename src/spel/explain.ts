import { isChainNode, type Node } from './ast';
import { evaluate, type EvalEnv, type EvalOutcome } from './evaluator';
import type { TemplateSchema } from './schema';
import type { SpelValue } from './types';

/** A tree describing how one expression was worked out against sample data. */

export type ExplainState =
  | { readonly kind: 'value'; readonly value: SpelValue }
  | { readonly kind: 'error'; readonly message: string | null }
  | { readonly kind: 'unsupported'; readonly message: string | null }
  | { readonly kind: 'skipped' }
  | { readonly kind: 'perItem' };

export interface ExplainNode {
  readonly id: string;
  readonly role: string | null;
  readonly source: string;
  readonly from: number;
  readonly to: number;
  readonly state: ExplainState;
  readonly children: readonly ExplainNode[];
}

interface Context {
  readonly source: string;
  readonly traced: ReadonlyMap<Node, SpelValue>;
  readonly failure: Extract<EvalOutcome, { ok: false }> | null;
  readonly schema: TemplateSchema;
}

export function explainExpression(ast: Node, env: EvalEnv): { readonly tree: ExplainNode; readonly outcome: EvalOutcome } {
  const traced = new Map<Node, SpelValue>();
  const outcome = evaluate(ast, env, (node, value) => traced.set(node, value));
  const ctx: Context = { source: env.source, traced, failure: outcome.ok ? null : outcome, schema: env.schema };
  return { tree: build(ast, null, false, ctx), outcome };
}

function stateOf(node: Node, perItem: boolean, ctx: Context): ExplainState {
  if (perItem) return { kind: 'perItem' };
  if (ctx.traced.has(node)) return { kind: 'value', value: ctx.traced.get(node) ?? null };
  const failure = ctx.failure;
  if (failure && node.from <= failure.from && failure.to <= node.to) {
    const exact = node.from === failure.from && node.to === failure.to;
    const message = exact || !hasFailingChild(node, ctx) ? failure.message : null;
    return failure.kind === 'error' ? { kind: 'error', message } : { kind: 'unsupported', message };
  }
  return { kind: 'skipped' };
}

function hasFailingChild(node: Node, ctx: Context): boolean {
  const failure = ctx.failure;
  if (!failure) return false;
  return childNodes(node).some((child) => child.node.from <= failure.from && failure.to <= child.node.to);
}

function build(node: Node, role: string | null, perItem: boolean, ctx: Context, asStep = false): ExplainNode {
  const children = asStep ? ownArguments(node) : childNodes(node, ctx.schema);
  return {
    id: `${node.from}-${node.to}-${role ?? ''}`,
    role,
    source: ctx.source.slice(node.from, node.to).trim(),
    from: node.from,
    to: node.to,
    state: stateOf(node, perItem, ctx),
    children: children.map((c) => build(c.node, c.role, perItem || c.perItem, ctx, c.asStep)),
  };
}

interface Child {
  readonly node: Node;
  readonly role: string | null;
  readonly perItem: boolean;
  /** A prefix of a property chain: show only its own arguments, not the chain again. */
  readonly asStep: boolean;
}

const child = (node: Node, role: string | null = null, perItem = false, asStep = false): Child => ({
  node,
  role,
  perItem,
  asStep,
});

/**
 * Children shown in the inspector. Property chains (`a.b.c`) are flattened into their
 * prefixes (`a`, `a.b`) so long paths read as a pipeline rather than a deep tree.
 */
function childNodes(node: Node, schema?: TemplateSchema): readonly Child[] {
  switch (node.type) {
    case 'ternary':
      return [child(node.test, 'if'), child(node.consequent, 'then'), child(node.alternate, 'else')];
    case 'elvis':
      return [child(node.left, 'value'), child(node.right, 'if empty')];
    case 'binary':
      return flattenOperands(node).map((operand) => child(operand));
    case 'unary':
      return [child(node.argument)];
    case 'functionCall': {
      const params = schema?.functions[node.name]?.params ?? [];
      return node.args.map((arg, i) => child(arg, params[i]?.name ?? null));
    }
    case 'list':
      return node.elements.map((element) => child(element));
    case 'map':
      return node.entries.map((entry) => child(entry.value, entry.key));
    case 'constructor':
      return node.args.map((arg) => child(arg));
    case 'member':
    case 'methodCall':
    case 'index':
    case 'selection':
    case 'projection':
      return chainChildren(node);
    default:
      return [];
  }
}

const FLATTENED_OPERATORS = new Set(['+', 'and', 'or']);

/** `a + b + c` parses as `(a + b) + c`; show it as one level with three parts. */
function flattenOperands(node: Extract<Node, { type: 'binary' }>): readonly Node[] {
  if (!FLATTENED_OPERATORS.has(node.operator)) return [node.left, node.right];
  const left = node.left;
  const leftParts = left.type === 'binary' && left.operator === node.operator ? flattenOperands(left) : [left];
  return [...leftParts, node.right];
}

function chainChildren(node: Node): readonly Child[] {
  const steps: Child[] = [];
  let current: Node | null = isChainNode(node) ? node.object : null;
  while (current) {
    // The innermost non-chain start (e.g. `#root`, a function call) keeps its own children.
    steps.unshift(child(current, 'step', false, isChainNode(current)));
    current = isChainNode(current) ? current.object : null;
  }
  return [...steps, ...ownArguments(node)];
}

function ownArguments(node: Node): readonly Child[] {
  switch (node.type) {
    case 'methodCall':
      return node.args.map((arg) => child(arg, 'argument'));
    case 'index':
      return [child(node.index, 'position')];
    case 'selection':
      return [child(node.predicate, 'filter', true)];
    case 'projection':
      return [child(node.expression, 'each item', true)];
    default:
      return [];
  }
}
