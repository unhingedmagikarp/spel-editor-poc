import type { TemplateAnalysis } from './analyze';
import { evaluate, type EvalEnv } from './evaluator';
import { EvalFailure, toTemplateString } from './values';

export type RenderPart =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'value'; readonly text: string; readonly from: number; readonly to: number }
  | {
      readonly kind: 'problem';
      readonly problem: 'error' | 'unsupported' | 'invalid';
      readonly message: string;
      readonly from: number;
      readonly to: number;
    };

/**
 * - ok: renders cleanly
 * - partial: renders, but some parts can't be previewed in the browser
 * - failed: the server would throw while rendering this message for this data
 * - invalid: syntax errors — the server can't even parse it
 */
export type RenderStatus = 'ok' | 'partial' | 'failed' | 'invalid';

export interface RenderResult {
  readonly parts: readonly RenderPart[];
  readonly status: RenderStatus;
  readonly firstProblem: Extract<RenderPart, { kind: 'problem' }> | null;
}

export type RenderEnv = Omit<EvalEnv, 'source'>;

export function renderTemplate(analysis: TemplateAnalysis, env: RenderEnv): RenderResult {
  const fullEnv: EvalEnv = { ...env, source: analysis.source };
  const parts = analysis.segments.map((segment): RenderPart => {
    if (segment.kind === 'text') return { kind: 'text', text: segment.text };
    const span = { from: segment.from, to: segment.to };
    if (!segment.closed) return { kind: 'problem', problem: 'invalid', message: "Close this '#{' with '}'.", ...span };
    if (!segment.ast) return { kind: 'problem', problem: 'invalid', message: 'Fix this expression to preview it.', ...span };
    const outcome = evaluate(segment.ast, fullEnv);
    if (!outcome.ok) return { kind: 'problem', problem: outcome.kind, message: outcome.message, ...span };
    try {
      return { kind: 'value', text: toTemplateString(outcome.value), ...span };
    } catch (error: unknown) {
      const message = error instanceof EvalFailure ? error.message : 'Cannot print this value.';
      return { kind: 'problem', problem: 'error', message, ...span };
    }
  });
  const problems = parts.filter((part): part is Extract<RenderPart, { kind: 'problem' }> => part.kind === 'problem');
  return { parts, status: statusOf(problems), firstProblem: problems[0] ?? null };
}

function statusOf(problems: readonly Extract<RenderPart, { kind: 'problem' }>[]): RenderStatus {
  if (problems.some((p) => p.problem === 'invalid')) return 'invalid';
  if (problems.some((p) => p.problem === 'error')) return 'failed';
  if (problems.length > 0) return 'partial';
  return 'ok';
}
