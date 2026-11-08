import { diagnostic, type SpelDiagnostic } from './types';

export type TokenKind =
  | 'number'
  | 'string'
  | 'identifier'
  | 'hash'
  | 'at'
  | 'dot'
  | 'safeNav'
  | 'lparen'
  | 'rparen'
  | 'lbracket'
  | 'rbracket'
  | 'lbrace'
  | 'rbrace'
  | 'comma'
  | 'colon'
  | 'question'
  | 'elvis'
  | 'select'
  | 'selectFirst'
  | 'selectLast'
  | 'project'
  | 'plus'
  | 'minus'
  | 'star'
  | 'slash'
  | 'percent'
  | 'caret'
  | 'not'
  | 'eq'
  | 'ne'
  | 'lt'
  | 'le'
  | 'gt'
  | 'ge'
  | 'and'
  | 'or'
  | 'assign'
  | 'eof';

export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  readonly from: number;
  readonly to: number;
  /** Parsed value for number and string literals. */
  readonly value: string | number | null;
}

export interface LexResult {
  readonly tokens: readonly Token[];
  readonly diagnostics: readonly SpelDiagnostic[];
}

/** Longest symbols first so `?.` wins over `?`. */
const SYMBOLS: ReadonlyArray<readonly [string, TokenKind]> = [
  ['?.', 'safeNav'],
  ['?:', 'elvis'],
  ['?[', 'select'],
  ['^[', 'selectFirst'],
  ['$[', 'selectLast'],
  ['![', 'project'],
  ['==', 'eq'],
  ['!=', 'ne'],
  ['<=', 'le'],
  ['>=', 'ge'],
  ['&&', 'and'],
  ['||', 'or'],
  ['.', 'dot'],
  ['(', 'lparen'],
  [')', 'rparen'],
  ['[', 'lbracket'],
  [']', 'rbracket'],
  ['{', 'lbrace'],
  ['}', 'rbrace'],
  [',', 'comma'],
  [':', 'colon'],
  ['?', 'question'],
  ['+', 'plus'],
  ['-', 'minus'],
  ['*', 'star'],
  ['/', 'slash'],
  ['%', 'percent'],
  ['^', 'caret'],
  ['!', 'not'],
  ['<', 'lt'],
  ['>', 'gt'],
  ['=', 'assign'],
  ['#', 'hash'],
  ['@', 'at'],
];

const IDENT_START = /[\p{L}_$]/u;
const IDENT_PART = /[\p{L}\p{N}_$]/u;
const DIGIT = /[0-9]/;
const WHITESPACE = /\s/;

interface Scanned {
  readonly token: Token;
  readonly diagnostic?: SpelDiagnostic;
}

function scanString(src: string, i: number, offset: number): Scanned {
  const quote = src.charAt(i);
  let j = i + 1;
  let value = '';
  while (j < src.length) {
    const ch = src.charAt(j);
    if (ch === quote) {
      if (src.charAt(j + 1) === quote) {
        value += quote;
        j += 2;
        continue;
      }
      const token: Token = { kind: 'string', text: src.slice(i, j + 1), from: offset + i, to: offset + j + 1, value };
      return { token };
    }
    value += ch;
    j++;
  }
  const token: Token = { kind: 'string', text: src.slice(i), from: offset + i, to: offset + src.length, value };
  return {
    token,
    diagnostic: diagnostic('error', `This text is never closed — add a matching ${quote}`, offset + i, offset + i + 1),
  };
}

function scanNumber(src: string, i: number, offset: number): Token {
  const hex = /^0[xX][0-9a-fA-F]+/.exec(src.slice(i));
  if (hex) {
    return { kind: 'number', text: hex[0], from: offset + i, to: offset + i + hex[0].length, value: parseInt(hex[0], 16) };
  }
  const match = /^[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?[lLdDfF]?/.exec(src.slice(i));
  const text = match ? match[0] : src.charAt(i);
  const numeric = text.replace(/[lLdDfF]$/, '');
  return { kind: 'number', text, from: offset + i, to: offset + i + text.length, value: Number(numeric) };
}

function scanIdentifier(src: string, i: number, offset: number): Token {
  let j = i + 1;
  while (j < src.length && IDENT_PART.test(src.charAt(j))) j++;
  const text = src.slice(i, j);
  return { kind: 'identifier', text, from: offset + i, to: offset + j, value: null };
}

function scanSymbol(src: string, i: number, offset: number): Token | null {
  for (const [symbol, kind] of SYMBOLS) {
    if (src.startsWith(symbol, i)) {
      return { kind, text: symbol, from: offset + i, to: offset + i + symbol.length, value: null };
    }
  }
  return null;
}

/**
 * Tokenizes a SpEL expression body. `offset` is the absolute position of `source` in the template,
 * so every token and diagnostic maps straight back to the editor document.
 */
export function tokenize(source: string, offset = 0): LexResult {
  const tokens: Token[] = [];
  const diagnostics: SpelDiagnostic[] = [];
  let i = 0;

  while (i < source.length) {
    const ch = source.charAt(i);
    if (WHITESPACE.test(ch)) {
      i++;
      continue;
    }
    const scanned = scanOne(source, i, offset);
    if (scanned.diagnostic) diagnostics.push(scanned.diagnostic);
    if (scanned.token) tokens.push(scanned.token);
    i = scanned.next;
  }
  const end = offset + source.length;
  tokens.push({ kind: 'eof', text: '', from: end, to: end, value: null });
  return { tokens, diagnostics };
}

interface ScanStep {
  readonly token: Token | null;
  readonly diagnostic?: SpelDiagnostic;
  readonly next: number;
}

function scanOne(src: string, i: number, offset: number): ScanStep {
  const ch = src.charAt(i);
  if (ch === "'" || ch === '"') {
    const { token, diagnostic: diag } = scanString(src, i, offset);
    return { token, next: token.to - offset, ...(diag ? { diagnostic: diag } : {}) };
  }
  if (DIGIT.test(ch)) {
    const token = scanNumber(src, i, offset);
    return { token, next: token.to - offset };
  }
  // `$[` (select last) must win over identifiers that start with `$`.
  const symbol = ch === '$' && src.charAt(i + 1) !== '[' ? null : scanSymbol(src, i, offset);
  if (symbol) return { token: symbol, next: symbol.to - offset };
  if (IDENT_START.test(ch)) {
    const token = scanIdentifier(src, i, offset);
    return { token, next: token.to - offset };
  }
  return {
    token: null,
    diagnostic: diagnostic('error', `Unexpected character '${ch}'`, offset + i, offset + i + 1),
    next: i + 1,
  };
}
