import { diagnostic, type SpelDiagnostic } from './types';

/**
 * Splits a template into plain text and `#{...}` expression segments,
 * mirroring Spring's TemplateParserContext (prefix `#{`, suffix `}`).
 */

export const EXPR_PREFIX = '#{';
export const EXPR_SUFFIX = '}';

export interface TextSegment {
  readonly kind: 'text';
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

export interface ExprSegment {
  readonly kind: 'expr';
  /** Start of `#{`. */
  readonly from: number;
  /** End of the closing `}` (or end of template when unclosed). */
  readonly to: number;
  readonly bodyFrom: number;
  readonly bodyTo: number;
  readonly body: string;
  readonly closed: boolean;
}

export type Segment = TextSegment | ExprSegment;

export interface SplitResult {
  readonly segments: readonly Segment[];
  readonly diagnostics: readonly SpelDiagnostic[];
}

const OPENERS: Readonly<Record<string, string>> = { '(': ')', '[': ']', '{': '}' };

/** Returns the index of the `}` that closes the expression starting at `from`, or -1. */
function findExpressionEnd(src: string, from: number): number {
  const stack: string[] = [];
  let i = from;
  while (i < src.length) {
    const ch = src.charAt(i);
    if (ch === "'" || ch === '"') {
      i = skipString(src, i, ch);
      continue;
    }
    if (OPENERS[ch]) {
      stack.push(OPENERS[ch]);
    } else if (ch === '}') {
      // A `}` closes the expression unless it closes an inline list/map opened inside it.
      if (stack.at(-1) !== '}') return i;
      stack.pop();
    } else if ((ch === ')' || ch === ']') && stack.at(-1) === ch) {
      stack.pop();
    }
    i++;
  }
  return -1;
}

/** Skips a SpEL string literal ('' or "" escape a quote). Returns index after the closing quote. */
function skipString(src: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < src.length) {
    if (src.charAt(i) === quote) {
      if (src.charAt(i + 1) === quote) {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i++;
  }
  return src.length;
}

export function splitTemplate(template: string): SplitResult {
  const segments: Segment[] = [];
  const diagnostics: SpelDiagnostic[] = [];
  let textStart = 0;
  let i = 0;

  const pushText = (to: number): void => {
    if (to > textStart) segments.push({ kind: 'text', from: textStart, to, text: template.slice(textStart, to) });
  };

  while (i < template.length) {
    if (!template.startsWith(EXPR_PREFIX, i)) {
      i++;
      continue;
    }
    pushText(i);
    const bodyFrom = i + EXPR_PREFIX.length;
    const end = findExpressionEnd(template, bodyFrom);
    const closed = end !== -1;
    const bodyTo = closed ? end : template.length;
    const to = closed ? end + 1 : template.length;
    const body = template.slice(bodyFrom, bodyTo);
    segments.push({ kind: 'expr', from: i, to, bodyFrom, bodyTo, body, closed });

    if (!closed) {
      diagnostics.push(
        diagnostic('error', "This '#{' is never closed — add a '}' where the expression ends.", i, bodyFrom),
      );
    } else if (body.trim() === '') {
      diagnostics.push(diagnostic('error', 'Empty expression — put something between #{ and }.', i, to));
    }
    i = to;
    textStart = to;
  }
  pushText(template.length);
  return { segments, diagnostics };
}
