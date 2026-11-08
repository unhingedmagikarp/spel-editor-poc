import { t, type FunctionDef } from '../spel/schema';
import type { SpelValue } from '../spel/types';
import {
  EvalFailure,
  expectDate,
  expectList,
  expectNumber,
  expectString,
  toJavaString,
} from '../spel/values';

/**
 * MOCK: functions the BE might register on its EvaluationContext (`context.registerFunction(...)`).
 * `preview` is the browser-side approximation; the BE implementation is the source of truth.
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = (n: number): string => String(n).padStart(2, '0');
const arg = (args: readonly SpelValue[], i: number): SpelValue => args[i] ?? null;

/** Subset of java.time DateTimeFormatter patterns: d dd M MM MMM MMMM yy yyyy EEE EEEE. */
function formatDate(date: Date, pattern: string): string {
  return pattern.replace(/E{3,4}|d{1,2}|M{1,4}|y{2,4}/g, (token) => {
    const day = DAYS[date.getUTCDay()] ?? '';
    const month = MONTHS[date.getUTCMonth()] ?? '';
    switch (token) {
      case 'EEEE':
        return day;
      case 'EEE':
        return day.slice(0, 3);
      case 'd':
        return String(date.getUTCDate());
      case 'dd':
        return pad(date.getUTCDate());
      case 'M':
        return String(date.getUTCMonth() + 1);
      case 'MM':
        return pad(date.getUTCMonth() + 1);
      case 'MMM':
        return month.slice(0, 3);
      case 'MMMM':
        return month;
      case 'yy':
        return String(date.getUTCFullYear()).slice(-2);
      default:
        return String(date.getUTCFullYear());
    }
  });
}

function formatPrice(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-IE', { style: 'currency', currency }).format(amount);
  } catch {
    throw new EvalFailure(`'${currency}' is not a currency code (use e.g. 'EUR').`);
  }
}

export const MOCK_FUNCTIONS: Readonly<Record<string, FunctionDef>> = {
  formatDate: {
    params: [
      { name: 'date', type: t.date },
      { name: 'pattern', type: t.string },
    ],
    returns: t.string,
    description: "Formats a date. Pattern letters: d, dd, MMM, MMMM, yyyy, EEE, EEEE — e.g. 'EEEE d MMMM' → Tuesday 10 November.",
    preview: (args) => formatDate(expectDate(arg(args, 0), 'date'), expectString(arg(args, 1), 'pattern')),
  },
  formatPrice: {
    params: [
      { name: 'amount', type: t.number },
      { name: 'currency', type: t.string },
    ],
    returns: t.string,
    description: "Formats an amount as money, e.g. #formatPrice(order.total, order.currency) → €154.80.",
    preview: (args) => formatPrice(expectNumber(arg(args, 0), 'amount'), expectString(arg(args, 1), 'currency')),
  },
  pluralize: {
    params: [
      { name: 'count', type: t.number },
      { name: 'singular', type: t.string },
      { name: 'plural', type: t.string },
    ],
    returns: t.string,
    description: "Count + the right word: #pluralize(3, 'item', 'items') → 3 items.",
    preview: (args) => {
      const count = expectNumber(arg(args, 0), 'count');
      const word = count === 1 ? expectString(arg(args, 1), 'singular') : expectString(arg(args, 2), 'plural');
      return `${count} ${word}`;
    },
  },
  join: {
    params: [
      { name: 'list', type: t.list(t.unknown) },
      { name: 'separator', type: t.string },
    ],
    returns: t.string,
    description: "Joins a list into text: #join(order.items.![name], ', ').",
    preview: (args) => expectList(arg(args, 0), 'list').map(toJavaString).join(expectString(arg(args, 1), 'separator')),
  },
  sum: {
    params: [{ name: 'numbers', type: t.list(t.number) }],
    returns: t.number,
    description: 'Adds up a list of numbers: #sum(order.items.![price * quantity]).',
    preview: (args) =>
      expectList(arg(args, 0), 'numbers').reduce<number>((total, n) => total + expectNumber(n, 'Each item'), 0),
  },
  capitalize: {
    params: [{ name: 'text', type: t.string }],
    returns: t.string,
    description: "First letter in capitals: #capitalize('hello') → Hello.",
    preview: (args) => {
      const text = expectString(arg(args, 0), 'text');
      return text.charAt(0).toUpperCase() + text.slice(1);
    },
  },
  trackingUrl: {
    params: [{ name: 'orderNumber', type: t.string }],
    returns: t.string,
    description: 'Link to the carrier tracking page. Server-only: not available in the preview.',
  },
};
