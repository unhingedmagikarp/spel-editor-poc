import type { Span, SpelRecord, SpelValue } from './types';

export type FailureKind = 'error' | 'unsupported';

/**
 * Thrown while evaluating.
 * - `error`: the BE would fail too (e.g. reading a field of null).
 * - `unsupported`: the browser preview can't mimic this; the BE may still be fine.
 */
export class EvalFailure extends Error {
  constructor(
    message: string,
    readonly kind: FailureKind = 'error',
    readonly span: Span | null = null,
  ) {
    super(message);
  }

  withSpan(span: Span): EvalFailure {
    return this.span ? this : new EvalFailure(this.message, this.kind, span);
  }
}

export function isRecord(value: SpelValue): value is SpelRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

export function isList(value: SpelValue): value is readonly SpelValue[] {
  return Array.isArray(value);
}

/** Short description used inside error messages. */
export function describeValue(value: SpelValue): string {
  if (value === null) return 'empty (null)';
  if (typeof value === 'string') return `the text '${truncate(value, 24)}'`;
  if (typeof value === 'number') return `the number ${value}`;
  if (typeof value === 'boolean') return `the value ${value}`;
  if (value instanceof Date) return 'a date';
  if (isList(value)) return `a list of ${value.length} item${value.length === 1 ? '' : 's'}`;
  return 'an object';
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Java-ish `String.valueOf`, used by string concatenation (`'a' + x`). */
export function toJavaString(value: SpelValue): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return isoDate(value);
  if (isList(value)) return `[${value.map(toJavaString).join(', ')}]`;
  return 'Object@1b6d3586';
}

/**
 * How a top-level `#{...}` result ends up in the message.
 * Mirrors Spring's CompositeStringExpression + DefaultConversionService:
 * null renders nothing, collections join with ",", plain objects can't be converted.
 */
export function toTemplateString(value: SpelValue): string {
  if (value === null) return '';
  if (isList(value)) return value.map((item) => (item === null ? '' : toJavaString(item))).join(',');
  if (isRecord(value)) {
    throw new EvalFailure("This is a whole object, not text — the server can't print it. Pick one of its fields.");
  }
  return toJavaString(value);
}

/** Compact rendering for the inspector panel. */
export function formatForInspector(value: SpelValue): string {
  if (value === null) return 'empty';
  if (typeof value === 'string') return `'${truncate(value, 60)}'`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return isoDate(value);
  if (isList(value)) return `list · ${value.length} item${value.length === 1 ? '' : 's'}`;
  return 'object';
}

// ---- argument coercion (throws friendly EvalFailures) ----------------------

export function expectString(value: SpelValue, what: string): string {
  if (typeof value !== 'string') throw new EvalFailure(`${what} must be text, but got ${describeValue(value)}.`);
  return value;
}

export function expectNumber(value: SpelValue, what: string): number {
  if (typeof value !== 'number') throw new EvalFailure(`${what} must be a number, but got ${describeValue(value)}.`);
  return value;
}

export function expectInteger(value: SpelValue, what: string): number {
  const n = expectNumber(value, what);
  if (!Number.isInteger(n)) throw new EvalFailure(`${what} must be a whole number, but got ${n}.`);
  return n;
}

export function expectBoolean(value: SpelValue, what: string): boolean {
  if (typeof value !== 'boolean') {
    throw new EvalFailure(`${what} must be true or false, but got ${describeValue(value)}.`);
  }
  return value;
}

export function expectList(value: SpelValue, what: string): readonly SpelValue[] {
  if (!isList(value)) throw new EvalFailure(`${what} must be a list, but got ${describeValue(value)}.`);
  return value;
}

export function expectDate(value: SpelValue, what: string): Date {
  if (!(value instanceof Date)) throw new EvalFailure(`${what} must be a date, but got ${describeValue(value)}.`);
  return value;
}
