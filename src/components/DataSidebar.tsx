import { useState } from 'react';
import { callSnippet } from '../spel/completion';
import { formatSignature } from '../spel/members';
import { describeType, type PropertyDef, type SpelType, type TemplateSchema } from '../spel';

interface DataSidebarProps {
  readonly schema: TemplateSchema;
  readonly onInsertPath: (path: string) => void;
  readonly onInsertSnippet: (snippet: string) => void;
}

interface Pattern {
  readonly label: string;
  readonly example: string;
  readonly snippet: string;
}

const PATTERNS: readonly Pattern[] = [
  { label: 'Either / or', example: "cond ? 'a' : 'b'", snippet: "${condition} ? '${yes}' : '${no}'" },
  { label: 'Fallback if empty', example: "value ?: 'default'", snippet: "${value} ?: '${fallback}'" },
  { label: 'Safe when empty', example: 'a?.b', snippet: '${object}?.${field}' },
  { label: 'Filter a list', example: 'items.?[onSale]', snippet: '${list}.?[${condition}]' },
  { label: 'Pick from each item', example: 'items.![name]', snippet: '${list}.![${field}]' },
  { label: 'First match', example: 'items.^[price > 50]', snippet: '${list}.^[${condition}]' },
];

/** Element type of a list of objects, so its item fields can be listed. */
function objectName(type: SpelType): string | null {
  if (type.kind === 'object') return type.name;
  if (type.kind === 'list' && type.element.kind === 'object') return type.element.name;
  return null;
}

interface FieldRowProps {
  readonly name: string;
  readonly def: PropertyDef;
  readonly path: string;
  readonly schema: TemplateSchema;
  readonly depth: number;
  readonly insideList: boolean;
  readonly onInsert: (path: string) => void;
}

function FieldRow({ name, def, path, schema, depth, insideList, onInsert }: FieldRowProps) {
  const [open, setOpen] = useState(depth === 0);
  const childType = objectName(def.type);
  const children = childType ? schema.types[childType]?.properties : undefined;
  const isList = def.type.kind === 'list';
  const title = [def.description, def.enumValues ? `Values: ${def.enumValues.join(', ')}` : null]
    .filter(Boolean)
    .join('\n');

  return (
    <li className="field">
      <div className="field-row">
        {children ? (
          <button
            type="button"
            className={`disclosure ${open ? 'is-open' : ''}`}
            aria-expanded={open}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${name}`}
            onClick={() => setOpen((v) => !v)}
          />
        ) : (
          <span className="disclosure-spacer" />
        )}
        <button
          type="button"
          className="field-name"
          title={title || `Insert ${path}`}
          onClick={() => onInsert(insideList ? name : path)}
        >
          {name}
        </button>
        <span className="field-type">{describeType(def.type)}</span>
        {def.nullable ? <span className="pill pill-warn" title="Can be empty — use ?. after it">may be empty</span> : null}
      </div>
      {open && children ? (
        <>
          {isList ? <p className="field-note">each item has · use inside {path}.?[ … ]</p> : null}
          <ul className="fields">
            {Object.entries(children).map(([childName, childDef]) => (
              <FieldRow
                key={childName}
                name={childName}
                def={childDef}
                path={isList ? childName : `${path}${def.nullable ? '?.' : '.'}${childName}`}
                schema={schema}
                depth={depth + 1}
                insideList={insideList || isList}
                onInsert={onInsert}
              />
            ))}
          </ul>
        </>
      ) : null}
    </li>
  );
}

export function DataSidebar({ schema, onInsertPath, onInsertSnippet }: DataSidebarProps) {
  const root = schema.types[schema.rootType];
  return (
    <aside className="sidebar" aria-label="Available data">
      <section>
        <h3 className="section-title">Available data</h3>
        <p className="section-hint">Click to insert at the cursor.</p>
        <ul className="fields">
          {Object.entries(root?.properties ?? {}).map(([name, def]) => (
            <FieldRow
              key={name}
              name={name}
              def={def}
              path={name}
              schema={schema}
              depth={0}
              insideList={false}
              onInsert={onInsertPath}
            />
          ))}
        </ul>
      </section>

      <section>
        <h3 className="section-title">Functions</h3>
        <ul className="functions">
          {Object.entries(schema.functions).map(([name, def]) => (
            <li key={name}>
              <button type="button" onClick={() => onInsertSnippet(callSnippet(`#${name}`, def.params))} title={def.description}>
                <code>#{formatSignature(name, def.params)}</code>
                <span>{def.description}</span>
                {def.preview ? null : <span className="pill pill-muted">server only</span>}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="section-title">Patterns</h3>
        <ul className="patterns">
          {PATTERNS.map((pattern) => (
            <li key={pattern.label}>
              <button type="button" onClick={() => onInsertSnippet(pattern.snippet)}>
                <span>{pattern.label}</span>
                <code>{pattern.example}</code>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
