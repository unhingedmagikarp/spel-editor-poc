import { t, type ParamDef, type SpelType } from './schema';
import type { SpelValue } from './types';
import {
  EvalFailure,
  expectDate,
  expectInteger,
  expectList,
  expectString,
  isoDate,
} from './values';

/**
 * Java methods/getters the preview understands on built-in types (String, List, LocalDate).
 * Signature (for checking/autocomplete) and browser implementation live side by side so they can't drift.
 */
export interface BuiltinMethod {
  readonly params: readonly ParamDef[];
  readonly returns: (receiver: SpelType) => SpelType;
  readonly description: string;
  readonly impl: (target: SpelValue, args: readonly SpelValue[]) => SpelValue;
}

export interface BuiltinProperty {
  readonly type: SpelType;
  readonly description: string;
  readonly get: (target: SpelValue) => SpelValue;
}

const p = (name: string, type: SpelType, optional = false): ParamDef => ({ name, type, optional });
const returns = (type: SpelType) => (): SpelType => type;
const arg = (args: readonly SpelValue[], i: number): SpelValue => args[i] ?? null;

export const STRING_METHODS: Readonly<Record<string, BuiltinMethod>> = {
  toUpperCase: {
    params: [],
    returns: returns(t.string),
    description: 'The text in CAPITALS.',
    impl: (s) => expectString(s, 'The value').toUpperCase(),
  },
  toLowerCase: {
    params: [],
    returns: returns(t.string),
    description: 'The text in lower case.',
    impl: (s) => expectString(s, 'The value').toLowerCase(),
  },
  trim: {
    params: [],
    returns: returns(t.string),
    description: 'Removes spaces at the start and end.',
    impl: (s) => expectString(s, 'The value').trim(),
  },
  length: {
    params: [],
    returns: returns(t.number),
    description: 'Number of characters.',
    impl: (s) => expectString(s, 'The value').length,
  },
  isEmpty: {
    params: [],
    returns: returns(t.boolean),
    description: 'true when the text has no characters.',
    impl: (s) => expectString(s, 'The value').length === 0,
  },
  substring: {
    params: [p('start', t.number), p('end', t.number, true)],
    returns: returns(t.string),
    description: 'Part of the text, from start (counting from 0) up to end.',
    impl: (s, args) => substring(expectString(s, 'The value'), args),
  },
  contains: {
    params: [p('text', t.string)],
    returns: returns(t.boolean),
    description: 'true when the text contains the given text (case-sensitive).',
    impl: (s, args) => expectString(s, 'The value').includes(expectString(arg(args, 0), 'text')),
  },
  startsWith: {
    params: [p('text', t.string)],
    returns: returns(t.boolean),
    description: 'true when the text starts with the given text.',
    impl: (s, args) => expectString(s, 'The value').startsWith(expectString(arg(args, 0), 'text')),
  },
  endsWith: {
    params: [p('text', t.string)],
    returns: returns(t.boolean),
    description: 'true when the text ends with the given text.',
    impl: (s, args) => expectString(s, 'The value').endsWith(expectString(arg(args, 0), 'text')),
  },
  replace: {
    params: [p('find', t.string), p('replaceWith', t.string)],
    returns: returns(t.string),
    description: 'Replaces every occurrence of find.',
    impl: (s, args) =>
      expectString(s, 'The value')
        .split(expectString(arg(args, 0), 'find'))
        .join(expectString(arg(args, 1), 'replaceWith')),
  },
  equalsIgnoreCase: {
    params: [p('other', t.string)],
    returns: returns(t.boolean),
    description: 'Compares text ignoring upper/lower case.',
    impl: (s, args) => {
      const other = arg(args, 0);
      return typeof other === 'string' && expectString(s, 'The value').toLowerCase() === other.toLowerCase();
    },
  },
};

function substring(text: string, args: readonly SpelValue[]): string {
  const start = expectInteger(arg(args, 0), 'start');
  const end = args.length > 1 ? expectInteger(arg(args, 1), 'end') : text.length;
  if (start < 0 || end > text.length || start > end) {
    throw new EvalFailure(`substring(${start}, ${end}) is out of range — the text is only ${text.length} characters long.`);
  }
  return text.slice(start, end);
}

const elementOf = (receiver: SpelType): SpelType => (receiver.kind === 'list' ? receiver.element : t.unknown);

export const LIST_METHODS: Readonly<Record<string, BuiltinMethod>> = {
  size: {
    params: [],
    returns: returns(t.number),
    description: 'Number of items in the list.',
    impl: (list) => expectList(list, 'The value').length,
  },
  isEmpty: {
    params: [],
    returns: returns(t.boolean),
    description: 'true when the list has no items.',
    impl: (list) => expectList(list, 'The value').length === 0,
  },
  get: {
    params: [p('index', t.number)],
    returns: elementOf,
    description: 'The item at a position (the first item is 0).',
    impl: (list, args) => listGet(expectList(list, 'The value'), expectInteger(arg(args, 0), 'index')),
  },
  contains: {
    params: [p('value', t.unknown)],
    returns: returns(t.boolean),
    description: 'true when the list contains the value.',
    impl: (list, args) => expectList(list, 'The value').includes(arg(args, 0)),
  },
};

function listGet(list: readonly SpelValue[], index: number): SpelValue {
  if (index < 0 || index >= list.length) {
    throw new EvalFailure(`There is no item ${index} — the list has ${list.length} item${list.length === 1 ? '' : 's'}.`);
  }
  return list[index] ?? null;
}

const DAY_NAMES = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'] as const;
const DAY_MS = 86_400_000;

export const DATE_PROPERTIES: Readonly<Record<string, BuiltinProperty>> = {
  year: { type: t.number, description: 'The year, e.g. 2026.', get: (d) => expectDate(d, 'The value').getUTCFullYear() },
  monthValue: { type: t.number, description: 'Month 1–12.', get: (d) => expectDate(d, 'The value').getUTCMonth() + 1 },
  dayOfMonth: { type: t.number, description: 'Day of the month 1–31.', get: (d) => expectDate(d, 'The value').getUTCDate() },
  dayOfWeek: {
    type: t.string,
    description: 'MONDAY … SUNDAY.',
    get: (d) => DAY_NAMES[expectDate(d, 'The value').getUTCDay()] ?? null,
  },
};

export const DATE_METHODS: Readonly<Record<string, BuiltinMethod>> = {
  isBefore: {
    params: [p('other', t.date)],
    returns: returns(t.boolean),
    description: 'true when this date is before the other date.',
    impl: (d, args) => expectDate(d, 'The value').getTime() < expectDate(arg(args, 0), 'other').getTime(),
  },
  isAfter: {
    params: [p('other', t.date)],
    returns: returns(t.boolean),
    description: 'true when this date is after the other date.',
    impl: (d, args) => expectDate(d, 'The value').getTime() > expectDate(arg(args, 0), 'other').getTime(),
  },
  plusDays: {
    params: [p('days', t.number)],
    returns: returns(t.date),
    description: 'A new date, the given number of days later.',
    impl: (d, args) => new Date(expectDate(d, 'The value').getTime() + expectInteger(arg(args, 0), 'days') * DAY_MS),
  },
  toString: {
    params: [],
    returns: returns(t.string),
    description: 'The date as 2026-11-08.',
    impl: (d: SpelValue) => isoDate(expectDate(d, 'The value')),
  },
};

export function builtinMethodsFor(type: SpelType): Readonly<Record<string, BuiltinMethod>> {
  switch (type.kind) {
    case 'string':
      return STRING_METHODS;
    case 'list':
      return LIST_METHODS;
    case 'date':
      return DATE_METHODS;
    default:
      return {};
  }
}

/** Runtime lookup by value (the preview doesn't know static types). */
export function builtinMethodsForValue(value: SpelValue): Readonly<Record<string, BuiltinMethod>> {
  if (typeof value === 'string') return STRING_METHODS;
  if (Array.isArray(value)) return LIST_METHODS;
  if (value instanceof Date) return DATE_METHODS;
  return {};
}
