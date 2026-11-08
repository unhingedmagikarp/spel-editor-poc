import { useState } from 'react';
import type { Sample } from '../mock/samples';
import type { RenderPart, RenderResult, RenderStatus, SpelValue } from '../spel';
import { isRecord } from '../spel/values';

/** Reads a nested text field from sample data, e.g. readText(data, 'store', 'name'). */
function readText(value: SpelValue, ...path: readonly string[]): string {
  const found = path.reduce<SpelValue>((current, key) => (isRecord(current) ? (current[key] ?? null) : null), value);
  return typeof found === 'string' ? found : '';
}

export interface SampleRender {
  readonly sample: Sample;
  readonly result: RenderResult;
}

interface PreviewProps {
  readonly renders: readonly SampleRender[];
  readonly active: SampleRender;
  readonly subject: string;
  readonly onSelectSample: (id: string) => void;
  readonly onJump: (pos: number) => void;
}

const STATUS_COPY: Readonly<Record<RenderStatus, string>> = {
  ok: 'Renders fine',
  partial: 'Renders — some parts only on the server',
  failed: 'Would fail to send',
  invalid: 'Has syntax errors',
};

function statusLine(render: SampleRender): string {
  const { result, sample } = render;
  if (result.status === 'ok') return `Renders fine for ${sample.label}.`;
  const reason = result.firstProblem?.message ?? '';
  if (result.status === 'failed') return `This message would fail for ${sample.label}: ${reason}`;
  if (result.status === 'invalid') return 'Fix the syntax errors to see the full preview.';
  return `Preview is approximate: ${reason}`;
}

function PartView({ part, highlight, onJump }: { readonly part: RenderPart; readonly highlight: boolean; readonly onJump: (pos: number) => void }) {
  if (part.kind === 'text') return <>{part.text}</>;
  if (part.kind === 'value') {
    return (
      <span
        className={highlight ? 'dyn' : undefined}
        onClick={() => onJump(part.from + 2)}
        title={highlight ? 'Dynamic — click to edit' : undefined}
      >
        {part.text}
      </span>
    );
  }
  return (
    <button type="button" className={`chip chip-${part.problem}`} title={part.message} onClick={() => onJump(part.from + 2)}>
      {part.problem === 'unsupported' ? 'server value' : part.problem === 'invalid' ? 'fix expression' : 'error'}
    </button>
  );
}

export function Preview({ renders, active, subject, onSelectSample, onJump }: PreviewProps) {
  const [highlight, setHighlight] = useState(true);
  const { result, sample } = active;
  const failing = renders.filter((r) => r.result.status === 'failed').length;

  return (
    <section className="preview" aria-label="Live preview">
      <header className="preview-head">
        <h3 className="section-title">Preview as</h3>
        <label className="toggle">
          <input type="checkbox" checked={highlight} onChange={(e) => setHighlight(e.target.checked)} />
          <span>Show dynamic parts</span>
        </label>
      </header>

      <div className="samples" role="tablist" aria-label="Sample customer">
        {renders.map((r) => (
          <button
            key={r.sample.id}
            type="button"
            role="tab"
            aria-selected={r.sample.id === sample.id}
            className={`sample ${r.sample.id === sample.id ? 'is-active' : ''}`}
            onClick={() => onSelectSample(r.sample.id)}
            title={STATUS_COPY[r.result.status]}
          >
            <span className={`dot dot-${r.result.status}`} aria-hidden />
            <span className="sample-name">{r.sample.label}</span>
            <span className="sample-desc">{r.sample.description}</span>
          </button>
        ))}
      </div>
      {failing > 0 ? (
        <p className="samples-warning">
          Fails for {failing} of {renders.length} sample customers — real customers will hit this too.
        </p>
      ) : null}

      <article className={`mail status-${result.status}`}>
        <div className="mail-meta">
          <span className="mail-from">{readText(sample.data, 'store', 'name') || 'Store'}</span>
          <span className="mail-to">to {readText(sample.data, 'customer', 'email')}</span>
        </div>
        <div className="mail-subject">{subject}</div>
        <div className="mail-body">
          {result.parts.length === 0 ? (
            <span className="mail-empty">Nothing to preview yet.</span>
          ) : (
            result.parts.map((part, i) => <PartView key={i} part={part} highlight={highlight} onJump={onJump} />)
          )}
        </div>
        <footer className={`mail-status mail-status-${result.status}`}>
          <span className={`dot dot-${result.status}`} aria-hidden />
          <span>{statusLine(active)}</span>
          {result.firstProblem ? (
            <button type="button" className="link" onClick={() => onJump((result.firstProblem?.from ?? 0) + 2)}>
              Show me
            </button>
          ) : null}
        </footer>
      </article>
    </section>
  );
}
