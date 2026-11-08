/** Absolute character range inside the full template string. */
export interface Span {
  readonly from: number;
  readonly to: number;
}

export type Severity = 'error' | 'warning' | 'info';

/** A one-click text replacement that resolves a diagnostic. */
export interface QuickFix extends Span {
  readonly label: string;
  readonly insert: string;
}

export interface SpelDiagnostic extends Span {
  readonly severity: Severity;
  readonly message: string;
  readonly fix?: QuickFix;
}

/** Runtime values the browser-side preview works with (a JSON-ish mirror of the Java objects). */
export type SpelValue = string | number | boolean | null | Date | readonly SpelValue[] | SpelRecord;

export interface SpelRecord {
  readonly [key: string]: SpelValue;
}

/** Own-key lookup, so names like `constructor` or `toString` never resolve to Object.prototype. */
export function own<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

export function diagnostic(
  severity: Severity,
  message: string,
  from: number,
  to: number,
  fix?: QuickFix,
): SpelDiagnostic {
  return fix ? { severity, message, from, to, fix } : { severity, message, from, to };
}
