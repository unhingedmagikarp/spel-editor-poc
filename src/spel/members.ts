import { builtinMethodsFor, DATE_PROPERTIES } from './builtins';
import type { ParamDef, SpelType, TemplateSchema } from './schema';
import { own } from './types';

/** Static view of "what can I write after a dot" for a given type. */

export interface ResolvedProperty {
  readonly name: string;
  readonly type: SpelType;
  readonly nullable: boolean;
  readonly description?: string;
  readonly enumValues?: readonly string[];
}

export interface ResolvedMethod {
  readonly name: string;
  readonly params: readonly ParamDef[];
  readonly returns: SpelType;
  readonly description?: string;
}

export function propertiesOf(type: SpelType, schema: TemplateSchema): readonly ResolvedProperty[] {
  if (type.kind === 'date') {
    return Object.entries(DATE_PROPERTIES).map(([name, def]) => ({
      name,
      type: def.type,
      nullable: false,
      description: def.description,
    }));
  }
  if (type.kind !== 'object') return [];
  const def = own(schema.types, type.name);
  if (!def) return [];
  return Object.entries(def.properties).map(([name, prop]) => ({
    name,
    type: prop.type,
    nullable: prop.nullable ?? false,
    ...(prop.description ? { description: prop.description } : {}),
    ...(prop.enumValues ? { enumValues: prop.enumValues } : {}),
  }));
}

export function methodsOf(type: SpelType): readonly ResolvedMethod[] {
  return Object.entries(builtinMethodsFor(type)).map(([name, def]) => ({
    name,
    params: def.params,
    returns: def.returns(type),
    description: def.description,
  }));
}

export function findProperty(type: SpelType, name: string, schema: TemplateSchema): ResolvedProperty | undefined {
  return propertiesOf(type, schema).find((prop) => prop.name === name);
}

export function findMethod(type: SpelType, name: string): ResolvedMethod | undefined {
  return methodsOf(type).find((method) => method.name === name);
}

export function formatSignature(name: string, params: readonly ParamDef[]): string {
  return `${name}(${params.map((param) => (param.optional ? `${param.name}?` : param.name)).join(', ')})`;
}

export function arityMessage(name: string, params: readonly ParamDef[], given: number): string | null {
  const required = params.filter((param) => !param.optional).length;
  if (given >= required && given <= params.length) return null;
  const needs = required === params.length ? `${required}` : `${required}–${params.length}`;
  const noun = params.length === 1 ? 'value' : 'values';
  return `${formatSignature(name, params)} takes ${needs} ${noun}, but got ${given}.`;
}
