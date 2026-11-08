import { Facet, StateField, type EditorState } from '@codemirror/state';
import { analyzeTemplate, EMPTY_SCHEMA, type TemplateAnalysis, type TemplateSchema } from '../spel';

/** The schema the editor checks against. Swapped at runtime through a Compartment. */
export const schemaFacet = Facet.define<TemplateSchema, TemplateSchema>({
  combine: (values) => values[0] ?? EMPTY_SCHEMA,
});

const analyze = (state: EditorState): TemplateAnalysis =>
  analyzeTemplate(state.doc.toString(), state.facet(schemaFacet));

/** Single source of truth for highlighting, linting and autocomplete. Recomputed on every edit. */
export const analysisField = StateField.define<TemplateAnalysis>({
  create: analyze,
  update: (value, tr) =>
    tr.docChanged || tr.startState.facet(schemaFacet) !== tr.state.facet(schemaFacet) ? analyze(tr.state) : value,
});
