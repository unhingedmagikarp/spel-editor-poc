import { useMemo } from 'react';
import type { Sample } from '../mock/samples';
import {
  explainExpression,
  formatForInspector,
  type AnalyzedExpression,
  type ExplainNode,
  type ExplainState,
  type TemplateAnalysis,
  type TemplateSchema,
} from '../spel';

interface BreakdownProps {
  readonly expression: AnalyzedExpression | undefined;
  readonly analysis: TemplateAnalysis;
  readonly sample: Sample;
  readonly schema: TemplateSchema;
  readonly onJump: (pos: number) => void;
}

function StateBadge({ state }: { readonly state: ExplainState }) {
  switch (state.kind) {
    case 'value':
      return <span className={state.value === null ? 'val val-null' : 'val'}>{formatForInspector(state.value)}</span>;
    case 'skipped':
      return <span className="val val-muted">not used</span>;
    case 'perItem':
      return <span className="val val-muted">checked per item</span>;
    case 'unsupported':
      return <span className="val val-warn">server only</span>;
    case 'error':
      return <span className="val val-error">fails</span>;
  }
}

function Row({ node, onJump }: { readonly node: ExplainNode; readonly onJump: (pos: number) => void }) {
  const message = node.state.kind === 'error' || node.state.kind === 'unsupported' ? node.state.message : null;
  return (
    <li className={`bd-node bd-${node.state.kind}`}>
      <button type="button" className="bd-row" onClick={() => onJump(node.from)} title={node.source}>
        {node.role ? <span className="bd-role">{node.role}</span> : null}
        <code className="bd-src">{node.source}</code>
        <span className="bd-arrow" aria-hidden>
          →
        </span>
        <StateBadge state={node.state} />
      </button>
      {message ? <p className="bd-message">{message}</p> : null}
      {node.children.length > 0 ? (
        <ul className="bd-children">
          {node.children.map((child) => (
            <Row key={child.id} node={child} onJump={onJump} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function Overview({ analysis, onJump }: { readonly analysis: TemplateAnalysis; readonly onJump: (pos: number) => void }) {
  if (analysis.expressions.length === 0) {
    return <p className="bd-empty">No dynamic parts yet. Type #{'{'} in the editor to add one.</p>;
  }
  return (
    <>
      <p className="bd-empty">Put the cursor inside a #{'{…}'} to see step by step how it is worked out.</p>
      <ol className="bd-overview">
        {analysis.expressions.map((expr, i) => (
          <li key={expr.from}>
            <button type="button" onClick={() => onJump(expr.bodyFrom)}>
              <span className="bd-index">{i + 1}</span>
              <code>{expr.body.trim() || '(empty)'}</code>
            </button>
          </li>
        ))}
      </ol>
    </>
  );
}

export function Breakdown({ expression, analysis, sample, schema, onJump }: BreakdownProps) {
  const explained = useMemo(() => {
    if (!expression?.ast) return null;
    return explainExpression(expression.ast, {
      root: sample.data,
      schema,
      variables: sample.variables,
      source: analysis.source,
    });
  }, [expression, sample, schema, analysis.source]);

  return (
    <section className="breakdown" aria-label="Breakdown">
      <header className="breakdown-head">
        <h3 className="section-title">Breakdown</h3>
        {expression ? <span className="breakdown-for">for {sample.label}</span> : null}
      </header>
      {!expression ? <Overview analysis={analysis} onJump={onJump} /> : null}
      {expression && !expression.ast ? (
        <p className="bd-empty">Fix the syntax error in this expression first — see Checks.</p>
      ) : null}
      {explained ? (
        <ul className="bd-tree">
          <Row node={explained.tree} onJump={onJump} />
        </ul>
      ) : null}
    </section>
  );
}
