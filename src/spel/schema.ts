import type { SpelValue } from './types';

/**
 * Type model the editor checks expressions against.
 * In the real app this would be served by the BE (e.g. generated from the Java model).
 */
export type SpelType =
  | { readonly kind: 'string' }
  | { readonly kind: 'number' }
  | { readonly kind: 'boolean' }
  | { readonly kind: 'date' }
  | { readonly kind: 'null' }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'object'; readonly name: string }
  | { readonly kind: 'list'; readonly element: SpelType };

export const t = {
  string: { kind: 'string' } as SpelType,
  number: { kind: 'number' } as SpelType,
  boolean: { kind: 'boolean' } as SpelType,
  date: { kind: 'date' } as SpelType,
  null: { kind: 'null' } as SpelType,
  unknown: { kind: 'unknown' } as SpelType,
  object: (name: string): SpelType => ({ kind: 'object', name }),
  list: (element: SpelType): SpelType => ({ kind: 'list', element }),
} as const;

export interface PropertyDef {
  readonly type: SpelType;
  readonly description?: string;
  /** Can be null for some customers/orders — accessing a field on it without `?.` fails at render time. */
  readonly nullable?: boolean;
  /** Known values for enum-like text fields (case-sensitive, like Java enums). */
  readonly enumValues?: readonly string[];
}

export interface ParamDef {
  readonly name: string;
  readonly type: SpelType;
  readonly optional?: boolean;
}

export interface MethodDef {
  readonly params: readonly ParamDef[];
  readonly returns: SpelType;
  readonly description?: string;
}

export type PreviewFn = (args: readonly SpelValue[]) => SpelValue;

export interface FunctionDef extends MethodDef {
  /** Browser-side approximation used by the live preview. Omit when the preview can't mimic the BE. */
  readonly preview?: PreviewFn;
}

export interface ObjectTypeDef {
  readonly description?: string;
  readonly properties: Readonly<Record<string, PropertyDef>>;
}

export interface TemplateSchema {
  readonly rootType: string;
  readonly types: Readonly<Record<string, ObjectTypeDef>>;
  /** Registered SpEL functions, called as `#name(...)`. */
  readonly functions: Readonly<Record<string, FunctionDef>>;
  /** Context variables, referenced as `#name`. */
  readonly variables: Readonly<Record<string, PropertyDef>>;
}

export const EMPTY_SCHEMA: TemplateSchema = {
  rootType: 'Root',
  types: { Root: { properties: {} } },
  functions: {},
  variables: {},
};

/** Human wording for types, aimed at content editors rather than developers. */
export function describeType(type: SpelType): string {
  switch (type.kind) {
    case 'string':
      return 'text';
    case 'number':
      return 'number';
    case 'boolean':
      return 'true/false';
    case 'date':
      return 'date';
    case 'null':
      return 'empty';
    case 'unknown':
      return 'unknown';
    case 'object':
      return type.name;
    case 'list':
      return `list of ${describeType(type.element)}`;
  }
}

export function isKnown(type: SpelType): boolean {
  return type.kind !== 'unknown';
}
