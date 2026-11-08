import type { Severity, SpelDiagnostic } from '../spel';
import type { QuickFix } from '../spel/types';

interface ProblemListProps {
  readonly diagnostics: readonly SpelDiagnostic[];
  readonly source: string;
  readonly onSelect: (pos: number) => void;
  readonly onFix: (fix: QuickFix) => void;
}

const SEVERITY_ORDER: Readonly<Record<Severity, number>> = { error: 0, warning: 1, info: 2 };
const SEVERITY_LABEL: Readonly<Record<Severity, string>> = { error: 'Error', warning: 'Warning', info: 'Note' };

function lineOf(source: string, pos: number): number {
  return source.slice(0, pos).split('\n').length;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export function ProblemList({ diagnostics, source, onSelect, onFix }: ProblemListProps) {
  const sorted = [...diagnostics].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.from - b.from,
  );
  const count = (severity: Severity): number => diagnostics.filter((d) => d.severity === severity).length;
  const errors = count('error');
  const warnings = count('warning');
  const notes = count('info');

  return (
    <section className="problems" aria-label="Problems">
      <header className="problems-head">
        <h3 className="section-title">Checks</h3>
        {diagnostics.length === 0 ? (
          <span className="pill pill-ok">All good</span>
        ) : (
          <span className="problems-summary">
            {errors ? <span className="pill pill-error">{plural(errors, 'error')}</span> : null}
            {warnings ? <span className="pill pill-warn">{plural(warnings, 'warning')}</span> : null}
            {notes ? <span className="pill pill-info">{plural(notes, 'note')}</span> : null}
          </span>
        )}
      </header>
      {sorted.length > 0 ? (
        <ol className="problem-list">
          {sorted.map((d) => (
            <li key={`${d.from}-${d.to}-${d.message}`} className="problem-item">
              <button type="button" className={`problem problem-${d.severity}`} onClick={() => onSelect(d.from)}>
                <span className="problem-badge">{SEVERITY_LABEL[d.severity]}</span>
                <span className="problem-message">{d.message}</span>
                <span className="problem-where">
                  line {lineOf(source, d.from)} · <code>{source.slice(d.from, Math.max(d.to, d.from + 1)).slice(0, 28)}</code>
                </span>
              </button>
              {d.fix ? (
                <button type="button" className="fix" onClick={() => d.fix && onFix(d.fix)}>
                  {d.fix.label}
                </button>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
