import {
  autocompletion,
  snippetCompletion,
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { EditorView } from '@codemirror/view';
import { completeExpression, expressionAt, type CompletionOption } from '../spel';
import { analysisField, schemaFacet } from './state';

/** Characters after which suggestions open without the user typing a letter first. */
const TRIGGER_CHARS = new Set(['.', '#', '{', '[', '(', ',', ' ']);

function toCodeMirror(option: CompletionOption): Completion {
  const base: Completion = {
    label: option.label,
    type: option.kind,
    detail: option.detail,
    boost: option.boost,
    ...(option.info ? { info: option.info } : {}),
  };
  // Snippets without tab-stops don't move the cursor past the inserted text; plain text apply does.
  if (!option.snippet.includes('${')) return { ...base, apply: option.snippet.replace(/\\([{}])/g, '$1') };
  return snippetCompletion(option.snippet, base);
}

function spelCompletions(context: CompletionContext): CompletionResult | null {
  const expr = expressionAt(context.state.field(analysisField), context.pos);
  if (!expr) return null;
  const prefix = context.state.sliceDoc(expr.bodyFrom, context.pos);
  const result = completeExpression(prefix, expr.bodyFrom, context.state.facet(schemaFacet));
  if (!result || result.options.length === 0) return null;

  // Positions right after a complete value (e.g. `name |`) never get here: the parser rejects them.
  const typedWord = context.pos > result.from;
  const charBefore = context.state.sliceDoc(result.from - 1, result.from);
  if (!context.explicit && !typedWord && !TRIGGER_CHARS.has(charBefore)) return null;
  return { from: result.from, options: result.options.map(toCodeMirror), validFor: /^[\w$]*$/ };
}

export const spelAutocomplete = autocompletion({
  override: [spelCompletions],
  activateOnTyping: true,
  icons: true,
  closeOnBlur: true,
  maxRenderedOptions: 80,
});

/**
 * Typing `{` right after `#` inserts the closing `}` and opens suggestions;
 * typing `}` in front of an expression's own `}` just steps over it.
 */
export const expressionBraces = EditorView.inputHandler.of((view, from, to, text) => {
  const { state } = view;
  if (text === '{' && state.sliceDoc(from - 1, from) === '#') {
    view.dispatch({ changes: { from, to, insert: '{}' }, selection: { anchor: from + 1 }, userEvent: 'input.type' });
    startCompletion(view);
    return true;
  }
  if (text === '}' && from === to && state.sliceDoc(from, from + 1) === '}') {
    const expr = expressionAt(state.field(analysisField), from);
    if (expr?.closed && expr.bodyTo === from) {
      view.dispatch({ selection: { anchor: from + 1 }, userEvent: 'input.type' });
      return true;
    }
  }
  return false;
});
