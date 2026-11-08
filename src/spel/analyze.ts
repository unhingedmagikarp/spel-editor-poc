import type { Node } from './ast';
import { checkExpression, type TypeInfo } from './checker';
import { tokenize, type Token } from './lexer';
import { parseTokens } from './parser';
import { describeType, type TemplateSchema } from './schema';
import { splitTemplate, type ExprSegment, type TextSegment } from './template';
import { diagnostic, type SpelDiagnostic } from './types';

export interface AnalyzedExpression extends ExprSegment {
  readonly tokens: readonly Token[];
  /** null when the expression has syntax errors. */
  readonly ast: Node | null;
  readonly result: TypeInfo | null;
  readonly diagnostics: readonly SpelDiagnostic[];
}

export type AnalyzedSegment = TextSegment | AnalyzedExpression;

export interface TemplateAnalysis {
  readonly source: string;
  readonly segments: readonly AnalyzedSegment[];
  readonly expressions: readonly AnalyzedExpression[];
  readonly diagnostics: readonly SpelDiagnostic[];
}

export function analyzeTemplate(source: string, schema: TemplateSchema): TemplateAnalysis {
  const split = splitTemplate(source);
  const segments = split.segments.map((segment) =>
    segment.kind === 'text' ? segment : analyzeExpression(segment, schema),
  );
  const expressions = segments.filter((segment): segment is AnalyzedExpression => segment.kind === 'expr');
  const diagnostics = [...split.diagnostics, ...expressions.flatMap((expr) => expr.diagnostics)].sort(
    (a, b) => a.from - b.from,
  );
  return { source, segments, expressions, diagnostics };
}

function analyzeExpression(segment: ExprSegment, schema: TemplateSchema): AnalyzedExpression {
  const lexed = tokenize(segment.body, segment.bodyFrom);
  const empty = { ...segment, tokens: lexed.tokens, ast: null, result: null };
  // Unclosed `#{` swallows the rest of the message; its own diagnostic is enough.
  if (!segment.closed || segment.body.trim() === '') return { ...empty, diagnostics: [] };
  if (lexed.diagnostics.length > 0) return { ...empty, diagnostics: lexed.diagnostics };

  const parsed = parseTokens(lexed.tokens);
  if (!parsed.ast) return { ...empty, diagnostics: parsed.diagnostics };

  const checked = checkExpression(parsed.ast, schema);
  return {
    ...segment,
    tokens: lexed.tokens,
    ast: parsed.ast,
    result: checked.result,
    diagnostics: [...checked.diagnostics, ...outputDiagnostics(checked.result, parsed.ast)],
  };
}

/** Warnings about how the final value will look once printed into the message. */
function outputDiagnostics(result: TypeInfo, ast: Node): readonly SpelDiagnostic[] {
  const { type } = result;
  if (type.kind === 'object') {
    return [
      diagnostic(
        'warning',
        `This is a whole ${type.name}, not text — the server can't print it. Pick one of its fields, e.g. ${exampleField(ast)}.`,
        ast.from,
        ast.to,
      ),
    ];
  }
  if (type.kind === 'list') {
    return [
      diagnostic(
        'info',
        `A ${describeType(type)} prints as item1,item2,… — use #join(list, ', ') for nicer text.`,
        ast.from,
        ast.to,
      ),
    ];
  }
  if (type.kind === 'date') {
    return [
      diagnostic('info', "Dates print like 2026-11-08. Use #formatDate(date, 'd MMMM yyyy') for friendlier text.", ast.from, ast.to),
    ];
  }
  return [];
}

function exampleField(ast: Node): string {
  return ast.type === 'member' ? `${ast.name}.…` : '….name';
}

export function expressionAt(analysis: TemplateAnalysis, pos: number): AnalyzedExpression | undefined {
  return analysis.expressions.find((expr) => pos >= expr.bodyFrom && pos <= expr.bodyTo);
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly SpelDiagnostic[];
  readonly warnings: readonly SpelDiagnostic[];
}

/**
 * Framework-agnostic validation, e.g. for a zod `superRefine`:
 *   z.string().superRefine((v, ctx) => validateTemplate(v, schema).errors
 *     .forEach((e) => ctx.addIssue({ code: 'custom', message: e.message })))
 */
export function validateTemplate(source: string, schema: TemplateSchema): ValidationResult {
  const { diagnostics } = analyzeTemplate(source, schema);
  const errors = diagnostics.filter((d) => d.severity === 'error');
  return { valid: errors.length === 0, errors, warnings: diagnostics.filter((d) => d.severity === 'warning') };
}
