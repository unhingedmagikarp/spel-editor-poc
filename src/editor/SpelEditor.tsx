import { completionKeymap, snippet } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { bracketMatching } from '@codemirror/language';
import { lintKeymap } from '@codemirror/lint';
import { Compartment, EditorState } from '@codemirror/state';
import { drawSelection, EditorView, keymap, placeholder as placeholderExt } from '@codemirror/view';
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { expressionAt, type TemplateSchema } from '../spel';
import { expressionBraces, spelAutocomplete } from './autocomplete';
import { spelHighlight } from './highlight';
import { spelLinter } from './lint';
import { analysisField, schemaFacet } from './state';
import { spelTheme } from './theme';

export interface SpelEditorHandle {
  /** Inserts a field path; wraps it in `#{…}` when the cursor is in plain text. */
  insertPath(path: string): void;
  /** Inserts a CodeMirror snippet (`${name}` = tab-stop); wraps it in `#{…}` in plain text. */
  insertSnippet(template: string): void;
  /** Replaces a range of the template (used for quick fixes outside the editor). */
  replace(from: number, to: number, insert: string): void;
  moveCursor(pos: number): void;
  focus(): void;
}

export interface SpelEditorProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly schema: TemplateSchema;
  readonly onCursorChange?: (pos: number) => void;
  /** Wire to react-hook-form's `field.onBlur`. */
  readonly onBlur?: () => void;
  readonly placeholder?: string;
  readonly ariaLabel?: string;
}

/**
 * Drop-in replacement for a plain text input holding a SpEL template.
 * Controlled (`value` / `onChange`), so it works with react-hook-form's <Controller>.
 */
export const SpelEditor = forwardRef<SpelEditorHandle, SpelEditorProps>(function SpelEditor(props, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const schemaCompartment = useRef(new Compartment());
  const latest = useRef(props);

  useLayoutEffect(() => {
    latest.current = props;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const initial = latest.current;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: initial.value,
        extensions: [
          schemaCompartment.current.of(schemaFacet.of(initial.schema)),
          analysisField,
          history(),
          drawSelection(),
          bracketMatching(),
          EditorView.lineWrapping,
          spelHighlight,
          spelLinter,
          spelAutocomplete,
          expressionBraces,
          spelTheme,
          placeholderExt(initial.placeholder ?? 'Type your message… use #{ to add dynamic content'),
          EditorView.contentAttributes.of({ 'aria-label': initial.ariaLabel ?? 'Message template' }),
          keymap.of([...completionKeymap, ...lintKeymap, ...historyKeymap, ...defaultKeymap]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) latest.current.onChange(update.state.doc.toString());
            if (update.docChanged || update.selectionSet) {
              latest.current.onCursorChange?.(update.state.selection.main.head);
            }
            if (update.focusChanged && !update.view.hasFocus) latest.current.onBlur?.();
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // Controlled value: sync external changes (e.g. form reset) without fighting the user's typing.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === props.value) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: props.value } });
  }, [props.value]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: schemaCompartment.current.reconfigure(schemaFacet.of(props.schema)) });
  }, [props.schema]);

  useImperativeHandle(ref, () => createHandle(viewRef), []);

  return <div ref={hostRef} className="spel-editor" />;
});

function createHandle(viewRef: { readonly current: EditorView | null }): SpelEditorHandle {
  const insideExpression = (view: EditorView): boolean => {
    const { from } = view.state.selection.main;
    const expr = expressionAt(view.state.field(analysisField), from);
    return Boolean(expr && (expr.closed ? from < expr.to : true) && from >= expr.bodyFrom);
  };

  return {
    insertPath(path) {
      const view = viewRef.current;
      if (!view) return;
      const { from, to } = view.state.selection.main;
      const insert = insideExpression(view) ? path : `#{${path}}`;
      view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, scrollIntoView: true });
      view.focus();
    },
    insertSnippet(template) {
      const view = viewRef.current;
      if (!view) return;
      const { from, to } = view.state.selection.main;
      const wrapped = insideExpression(view) ? template : `#\\{${template}\\}`;
      snippet(wrapped)(view, null, from, to);
      view.focus();
    },
    replace(from, to, insert) {
      const view = viewRef.current;
      if (!view || to > view.state.doc.length) return;
      view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, userEvent: 'input.fix' });
      view.focus();
    },
    moveCursor(pos) {
      const view = viewRef.current;
      if (!view) return;
      const anchor = Math.min(pos, view.state.doc.length);
      view.dispatch({ selection: { anchor }, scrollIntoView: true });
      view.focus();
    },
    focus() {
      viewRef.current?.focus();
    },
  };
}
