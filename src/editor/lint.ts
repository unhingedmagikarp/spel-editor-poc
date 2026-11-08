import { linter, type Diagnostic } from '@codemirror/lint';
import type { SpelDiagnostic } from '../spel';
import { analysisField } from './state';

function toCodeMirror(d: SpelDiagnostic, docLength: number): Diagnostic {
  // Zero-width ranges are hard to see; widen to one character where possible.
  const to = d.to > d.from ? d.to : Math.min(d.from + 1, docLength);
  const from = to > d.from ? d.from : Math.max(0, d.from - 1);
  const fix = d.fix;
  return {
    from,
    to,
    severity: d.severity,
    message: d.message,
    source: 'SpEL',
    ...(fix
      ? {
          actions: [
            {
              name: fix.label,
              apply: (view, _from, _to) =>
                view.dispatch({ changes: { from: fix.from, to: fix.to, insert: fix.insert }, userEvent: 'input.fix' }),
            },
          ],
        }
      : {}),
  };
}

export const spelLinter = linter(
  (view) => {
    const length = view.state.doc.length;
    return view.state.field(analysisField).diagnostics.map((d) => toCodeMirror(d, length));
  },
  { delay: 200 },
);
