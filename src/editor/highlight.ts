import type { Range } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import type { Token } from '../spel/lexer';
import type { AnalyzedExpression } from '../spel';
import { analysisField } from './state';

const KEYWORDS = new Set([
  'true',
  'false',
  'null',
  'and',
  'or',
  'not',
  'eq',
  'ne',
  'lt',
  'le',
  'gt',
  'ge',
  'div',
  'mod',
  'matches',
  'between',
  'instanceof',
  'new',
  'T',
]);

const OPERATOR_KINDS = new Set<Token['kind']>([
  'plus', 'minus', 'star', 'slash', 'percent', 'caret', 'not', 'eq', 'ne', 'lt', 'le', 'gt', 'ge',
  'and', 'or', 'assign', 'question', 'colon', 'elvis',
]);

const BRACKET_KINDS = new Set<Token['kind']>([
  'lparen', 'rparen', 'lbracket', 'rbracket', 'lbrace', 'rbrace', 'select', 'selectFirst', 'selectLast', 'project',
]);

const marks = {
  expr: Decoration.mark({ class: 'cm-spel-expr' }),
  active: Decoration.mark({ class: 'cm-spel-expr cm-spel-active' }),
  delim: Decoration.mark({ class: 'cm-spel-delim' }),
  string: Decoration.mark({ class: 'cm-spel-string' }),
  number: Decoration.mark({ class: 'cm-spel-number' }),
  keyword: Decoration.mark({ class: 'cm-spel-keyword' }),
  property: Decoration.mark({ class: 'cm-spel-property' }),
  method: Decoration.mark({ class: 'cm-spel-method' }),
  variable: Decoration.mark({ class: 'cm-spel-variable' }),
  operator: Decoration.mark({ class: 'cm-spel-operator' }),
  bracket: Decoration.mark({ class: 'cm-spel-bracket' }),
  punct: Decoration.mark({ class: 'cm-spel-punct' }),
} as const;

function tokenMark(tok: Token, prev: Token | undefined, next: Token | undefined): Decoration | null {
  switch (tok.kind) {
    case 'string':
      return marks.string;
    case 'number':
      return marks.number;
    case 'hash':
    case 'at':
      return marks.variable;
    case 'dot':
    case 'safeNav':
    case 'comma':
      return marks.punct;
    case 'identifier':
      if (prev?.kind === 'hash' || prev?.kind === 'at') return marks.variable;
      if (KEYWORDS.has(tok.text) || KEYWORDS.has(tok.text.toLowerCase())) return marks.keyword;
      return next?.kind === 'lparen' ? marks.method : marks.property;
    default:
      if (OPERATOR_KINDS.has(tok.kind)) return marks.operator;
      if (BRACKET_KINDS.has(tok.kind)) return marks.bracket;
      return null;
  }
}

function expressionRanges(expr: AnalyzedExpression, active: boolean): Range<Decoration>[] {
  const ranges: Range<Decoration>[] = [(active ? marks.active : marks.expr).range(expr.from, expr.to)];
  ranges.push(marks.delim.range(expr.from, expr.bodyFrom));
  if (expr.closed) ranges.push(marks.delim.range(expr.bodyTo, expr.to));
  expr.tokens.forEach((tok, i) => {
    if (tok.to <= tok.from) return;
    const mark = tokenMark(tok, expr.tokens[i - 1], expr.tokens[i + 1]);
    if (mark) ranges.push(mark.range(tok.from, tok.to));
  });
  return ranges;
}

/** Colours text vs `#{…}` and the tokens inside; marks the expression under the cursor. */
export const spelHighlight = EditorView.decorations.compute([analysisField, 'selection'], (state): DecorationSet => {
  const head = state.selection.main.head;
  const ranges = state
    .field(analysisField)
    .expressions.flatMap((expr) => expressionRanges(expr, head >= expr.bodyFrom && head <= expr.bodyTo));
  return Decoration.set(ranges, true);
});
