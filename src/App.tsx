import { useCallback, useMemo, useRef, useState } from 'react';
import { Breakdown } from './components/Breakdown';
import { DataSidebar } from './components/DataSidebar';
import { Preview, type SampleRender } from './components/Preview';
import { ProblemList } from './components/ProblemList';
import { SpelEditor, type SpelEditorHandle } from './editor/SpelEditor';
import { MOCK_SCHEMA } from './mock/schema';
import { SAMPLES, type Sample } from './mock/samples';
import { TEMPLATE_PRESETS, type TemplatePreset } from './mock/templates';
import { analyzeTemplate, expressionAt, renderTemplate } from './spel';

const DEFAULT_PRESET: TemplatePreset = TEMPLATE_PRESETS[0] ?? { id: 'blank', label: 'Blank', field: 'Message', body: '' };
const DEFAULT_SAMPLE: Sample | undefined = SAMPLES[0];

export function App() {
  const [preset, setPreset] = useState<TemplatePreset>(DEFAULT_PRESET);
  const [template, setTemplate] = useState(DEFAULT_PRESET.body);
  const [sampleId, setSampleId] = useState(DEFAULT_SAMPLE?.id ?? '');
  const [cursor, setCursor] = useState(0);
  const editor = useRef<SpelEditorHandle>(null);

  const analysis = useMemo(() => analyzeTemplate(template, MOCK_SCHEMA), [template]);
  const renders = useMemo<readonly SampleRender[]>(
    () =>
      SAMPLES.map((sample) => ({
        sample,
        result: renderTemplate(analysis, { root: sample.data, schema: MOCK_SCHEMA, variables: sample.variables }),
      })),
    [analysis],
  );
  const active = renders.find((r) => r.sample.id === sampleId) ?? renders[0];
  const activeExpression = expressionAt(analysis, cursor);

  const choosePreset = (id: string): void => {
    const next = TEMPLATE_PRESETS.find((p) => p.id === id);
    if (!next) return;
    setPreset(next);
    setTemplate(next.body);
    setCursor(0);
  };

  const jumpTo = useCallback((pos: number) => editor.current?.moveCursor(pos), []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            #{'{'}
            <i>…</i>
            {'}'}
          </span>
          <div>
            <h1>Message editor</h1>
            <p>SpEL templates, with help · spike</p>
          </div>
        </div>
        <label className="preset">
          <span>Example</span>
          <select value={preset.id} onChange={(e) => choosePreset(e.target.value)}>
            {TEMPLATE_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      </header>

      <main className="workspace">
        <DataSidebar
          schema={MOCK_SCHEMA}
          onInsertPath={(path) => editor.current?.insertPath(path)}
          onInsertSnippet={(snippet) => editor.current?.insertSnippet(snippet)}
        />

        <section className="column column-edit" aria-label="Editor">
          <div className="field-label">
            <span className="eyebrow">CMS field</span>
            <h2>{preset.field}</h2>
          </div>
          <SpelEditor
            ref={editor}
            value={template}
            onChange={setTemplate}
            schema={MOCK_SCHEMA}
            onCursorChange={setCursor}
            ariaLabel={preset.field}
          />
          <p className="hint">
            Type <kbd>#{'{'}</kbd> to add dynamic content · <kbd>Ctrl</kbd>+<kbd>Space</kbd> for suggestions ·{' '}
            <kbd>Tab</kbd> jumps between snippet fields
          </p>
          <ProblemList
            diagnostics={analysis.diagnostics}
            source={template}
            onSelect={jumpTo}
            onFix={(fix) => editor.current?.replace(fix.from, fix.to, fix.insert)}
          />
        </section>

        <section className="column column-result" aria-label="Preview">
          {active ? (
            <>
              <Preview
                renders={renders}
                active={active}
                subject={preset.field}
                onSelectSample={setSampleId}
                onJump={jumpTo}
              />
              <Breakdown
                expression={activeExpression}
                analysis={analysis}
                sample={active.sample}
                schema={MOCK_SCHEMA}
                onJump={jumpTo}
              />
            </>
          ) : null}
        </section>
      </main>
    </div>
  );
}
