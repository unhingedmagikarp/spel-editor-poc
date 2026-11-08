import { checkExpression, CURSOR, type CompletionContext } from './checker';
import { tokenize } from './lexer';
import { formatSignature, methodsOf, propertiesOf, type ResolvedMethod, type ResolvedProperty } from './members';
import { parseTokens } from './parser';
import { describeType, type ParamDef, type SpelType, type TemplateSchema } from './schema';

export type CompletionKind = 'property' | 'method' | 'function' | 'variable';

export interface CompletionOption {
  readonly label: string;
  readonly kind: CompletionKind;
  readonly detail: string;
  readonly info?: string;
  /** CodeMirror snippet template (`${name}` marks a tab-stop). */
  readonly snippet: string;
  readonly boost: number;
}

export interface CompletionResult {
  /** Absolute position where the replaced word starts. */
  readonly from: number;
  readonly options: readonly CompletionOption[];
}

/**
 * Computes completions for a half-typed expression.
 * Trick: append a marker identifier at the cursor, parse leniently, and let the type checker
 * report the type of whatever the marker is attached to (e.g. `customer.` → Customer).
 */
export function completeExpression(prefix: string, bodyFrom: number, schema: TemplateSchema): CompletionResult | null {
  const lexed = tokenize(prefix + CURSOR, bodyFrom);
  const hasMarker = lexed.tokens.some((tok) => tok.kind === 'identifier' && tok.text.includes(CURSOR));
  if (!hasMarker) return null; // e.g. cursor inside a text literal
  const parsed = parseTokens(lexed.tokens, { lenientEof: true });
  if (!parsed.ast) return null;
  const { completion } = checkExpression(parsed.ast, schema);
  if (!completion) return null;
  const pos = bodyFrom + prefix.length;
  return { from: pos - completion.partial.length, options: optionsFor(completion, schema) };
}

function optionsFor(context: CompletionContext, schema: TemplateSchema): readonly CompletionOption[] {
  switch (context.kind) {
    case 'member':
      return memberOptions(context.receiver, schema);
    case 'reference':
      return [...memberOptions(context.thisType, schema), ...hashOptions(schema, true)];
    case 'variable':
      return hashOptions(schema, false);
  }
}

function memberOptions(type: SpelType, schema: TemplateSchema): readonly CompletionOption[] {
  return [...propertiesOf(type, schema).map(propertyOption), ...methodsOf(type).map(methodOption)];
}

function propertyOption(prop: ResolvedProperty): CompletionOption {
  const notes = [
    prop.description,
    prop.nullable ? 'Can be empty — use ?. after it.' : undefined,
    prop.enumValues ? `Values: ${prop.enumValues.join(', ')}` : undefined,
  ].filter((note): note is string => Boolean(note));
  return {
    label: prop.name,
    kind: 'property',
    detail: `${describeType(prop.type)}${prop.nullable ? ' · can be empty' : ''}`,
    ...(notes.length ? { info: notes.join('\n') } : {}),
    snippet: escapeSnippet(prop.name),
    boost: 2,
  };
}

function methodOption(method: ResolvedMethod): CompletionOption {
  return {
    label: method.name,
    kind: 'method',
    detail: `${formatSignature(method.name, method.params)} → ${describeType(method.returns)}`,
    ...(method.description ? { info: method.description } : {}),
    snippet: callSnippet(method.name, method.params),
    boost: 1,
  };
}

function hashOptions(schema: TemplateSchema, withHash: boolean): readonly CompletionOption[] {
  const prefix = withHash ? '#' : '';
  const builtins: readonly CompletionOption[] = [
    { label: `${prefix}root`, kind: 'variable', detail: 'the whole message data', snippet: `${prefix}root`, boost: -1 },
    { label: `${prefix}this`, kind: 'variable', detail: 'the current item', snippet: `${prefix}this`, boost: -1 },
  ];
  const variables = Object.entries(schema.variables).map(
    ([name, def]): CompletionOption => ({
      label: `${prefix}${name}`,
      kind: 'variable',
      detail: describeType(def.type),
      ...(def.description ? { info: def.description } : {}),
      snippet: escapeSnippet(`${prefix}${name}`),
      boost: 0,
    }),
  );
  const functions = Object.entries(schema.functions).map(
    ([name, def]): CompletionOption => ({
      label: `${prefix}${name}`,
      kind: 'function',
      detail: `${formatSignature(name, def.params)} → ${describeType(def.returns)}`,
      ...(def.description ? { info: def.description } : {}),
      snippet: callSnippet(`${prefix}${name}`, def.params),
      boost: 0,
    }),
  );
  return [...functions, ...variables, ...builtins];
}

/** `substring(${start})` — optional params are left out of the snippet but shown in the signature. */
export function callSnippet(name: string, params: readonly ParamDef[]): string {
  const required = params.filter((param) => !param.optional);
  return `${escapeSnippet(name)}(${required.map((param) => `\${${param.name}}`).join(', ')})`;
}

function escapeSnippet(text: string): string {
  return text.replace(/[{}]/g, (brace) => `\\${brace}`);
}
