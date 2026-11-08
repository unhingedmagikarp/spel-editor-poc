import type { BinaryOperator } from './ast';
import type { SpelValue } from './types';
import { describeValue, EvalFailure, expectList, expectNumber, expectString, toJavaString } from './values';

/** Java-flavoured semantics for SpEL's binary operators (excluding the short-circuit `and` / `or`). */
export function applyBinary(operator: BinaryOperator, left: SpelValue, right: SpelValue): SpelValue {
  switch (operator) {
    case '+':
      return plus(left, right);
    case '-':
      return expectNumber(left, "The left side of '-'") - expectNumber(right, "The right side of '-'");
    case '*':
      return expectNumber(left, "The left side of '*'") * expectNumber(right, "The right side of '*'");
    case '/':
      return divide(expectNumber(left, "The left side of '/'"), expectNumber(right, "The right side of '/'"));
    case '%':
      return expectNumber(left, "The left side of '%'") % expectNumber(right, "The right side of '%'");
    case '^':
      return expectNumber(left, "The left side of '^'") ** expectNumber(right, "The right side of '^'");
    case '==':
      return equalValues(left, right);
    case '!=':
      return !equalValues(left, right);
    case '<':
      return compareValues(left, right) < 0;
    case '<=':
      return compareValues(left, right) <= 0;
    case '>':
      return compareValues(left, right) > 0;
    case '>=':
      return compareValues(left, right) >= 0;
    case 'matches':
      return matches(left, right);
    case 'between':
      return between(left, right);
    case 'instanceof':
      throw new EvalFailure("The preview can't check 'instanceof' (Java types).", 'unsupported');
    case 'and':
    case 'or':
      throw new EvalFailure(`'${operator}' is handled by the evaluator.`);
  }
}

function plus(left: SpelValue, right: SpelValue): SpelValue {
  if (typeof left === 'string' || typeof right === 'string') return toJavaString(left) + toJavaString(right);
  if (typeof left === 'number' && typeof right === 'number') return left + right;
  throw new EvalFailure(`Can't add ${describeValue(left)} and ${describeValue(right)}.`);
}

function divide(left: number, right: number): number {
  if (Number.isInteger(left) && Number.isInteger(right)) {
    if (right === 0) throw new EvalFailure('Division by zero.');
    return Math.trunc(left / right); // Java integer division
  }
  return left / right;
}

export function equalValues(left: SpelValue, right: SpelValue): boolean {
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
  return left === right;
}

/** Spring's StandardTypeComparator: null sorts first; otherwise both sides must be the same kind. */
export function compareValues(left: SpelValue, right: SpelValue): number {
  if (left === null) return right === null ? 0 : -1;
  if (right === null) return 1;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  if (typeof left === 'string' && typeof right === 'string') return left < right ? -1 : left > right ? 1 : 0;
  if (typeof left === 'boolean' && typeof right === 'boolean') return Number(left) - Number(right);
  if (left instanceof Date && right instanceof Date) return left.getTime() - right.getTime();
  throw new EvalFailure(`Can't compare ${describeValue(left)} with ${describeValue(right)}.`);
}

function matches(left: SpelValue, right: SpelValue): boolean {
  const text = expectString(left, "The left side of 'matches'");
  const pattern = expectString(right, "The pattern of 'matches'");
  try {
    return new RegExp(`^(?:${pattern})$`).test(text); // Java's String.matches is a full match
  } catch {
    throw new EvalFailure(`'${pattern}' is not a valid pattern.`);
  }
}

function between(left: SpelValue, right: SpelValue): boolean {
  const range = expectList(right, "The right side of 'between'");
  if (range.length !== 2) throw new EvalFailure("'between' needs exactly two values, e.g. x between {1, 10}.");
  return compareValues(left, range[0] ?? null) >= 0 && compareValues(left, range[1] ?? null) <= 0;
}
