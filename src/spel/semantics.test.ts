import { describe, expect, it } from 'vitest';
import { MOCK_SCHEMA } from '../mock/schema';
import { SAMPLES } from '../mock/samples';
import { analyzeTemplate, validateTemplate } from './analyze';
import { completeExpression } from './completion';
import { evaluate } from './evaluator';
import { explainExpression } from './explain';
import { renderTemplate } from './render';

const anna = SAMPLES.find((s) => s.id === 'anna')!;
const ben = SAMPLES.find((s) => s.id === 'ben')!;

const messagesOf = (template: string): string[] => analyzeTemplate(template, MOCK_SCHEMA).diagnostics.map((d) => d.message);

const render = (template: string, sample = anna) =>
  renderTemplate(analyzeTemplate(template, MOCK_SCHEMA), { root: sample.data, schema: MOCK_SCHEMA, variables: sample.variables });

const value = (expr: string, sample = anna) => {
  const analysis = analyzeTemplate(`#{${expr}}`, MOCK_SCHEMA);
  const ast = analysis.expressions[0]?.ast;
  if (!ast) throw new Error(`parse failed: ${analysis.diagnostics.map((d) => d.message).join()}`);
  return evaluate(ast, { root: sample.data, schema: MOCK_SCHEMA, variables: sample.variables, source: analysis.source });
};

describe('checker', () => {
  it('accepts valid expressions without diagnostics', () => {
    expect(messagesOf("#{customer.firstName} #{order.items.?[onSale].![name]} #{#formatDate(order.placedAt, 'd MMM')}"))
      .toEqual(['A list of text prints as item1,item2,… — use #join(list, \', \') for nicer text.']);
  });

  it('suggests the right field name for typos', () => {
    expect(messagesOf('#{customer.fristName}')[0]).toBe("Customer has no field 'fristName'. Did you mean 'firstName'?");
  });

  it('warns about nullable access without ?.', () => {
    expect(messagesOf('#{customer.loyalty.points}')[0]).toMatch(/'loyalty' can be empty/);
    expect(messagesOf('#{customer.loyalty?.points ?: 0}')).toEqual([]);
  });

  it('flags case mismatches against known enum values', () => {
    expect(messagesOf("#{customer.tier == 'Gold'}")[0]).toMatch(/case-sensitive. Use 'GOLD'/);
  });

  it('requires true/false conditions', () => {
    expect(messagesOf("#{customer.loyalty ? 'a' : 'b'}")[0]).toMatch(/must be a true\/false check.*Loyalty/);
  });

  it('explains #root inside filters', () => {
    expect(messagesOf('#{order.items.?[price > order.total].size()}')[0]).toMatch(/write #root.order/);
    expect(messagesOf('#{order.items.?[price > #root.order.total].size()}')).toEqual([]);
  });

  it('checks method names, field-vs-method mixups and arity', () => {
    expect(messagesOf('#{customer.firstName.toUppercase()}')[0]).toMatch(/Did you mean 'toUpperCase'/);
    expect(messagesOf('#{order.items.size}')[0]).toMatch(/'size' is a method/);
    expect(messagesOf('#{#formatDate(order.placedAt)}')[0]).toMatch(/takes 2 values, but got 1/);
  });

  it('rejects single = and unknown functions', () => {
    expect(messagesOf("#{customer.tier = 'GOLD'}")[0]).toMatch(/use '=='/);
    expect(messagesOf('#{#formatDat(order.placedAt, "d")}')[0]).toMatch(/Did you mean '#formatDate'/);
  });

  it('never resolves names through Object.prototype', () => {
    expect(messagesOf('#{#constructor} #{#toString()} #{customer.constructor}')).toHaveLength(3);
    expect(value('customer.firstName.constructor()')).toMatchObject({ ok: false, kind: 'error' });
  });

  it('warns when a whole object would be printed', () => {
    expect(messagesOf('#{customer}')[0]).toMatch(/whole Customer, not text/);
  });

  it('offers quick fixes that produce a clean template', () => {
    const applyFirstFix = (template: string): string => {
      const fix = analyzeTemplate(template, MOCK_SCHEMA).diagnostics.find((d) => d.fix)?.fix;
      if (!fix) throw new Error(`no fix for ${template}`);
      return template.slice(0, fix.from) + fix.insert + template.slice(fix.to);
    };
    expect(applyFirstFix('#{customer.loyalty.points}')).toBe('#{customer.loyalty?.points}');
    expect(applyFirstFix('#{customer.fristName}')).toBe('#{customer.firstName}');
    expect(applyFirstFix("#{customer.tier == 'Gold'}")).toBe("#{customer.tier == 'GOLD'}");
    expect(applyFirstFix("#{customer.tier = 'GOLD'}")).toBe("#{customer.tier == 'GOLD'}");
    expect(applyFirstFix('#{order.items.size}')).toBe('#{order.items.size()}');
    expect(applyFirstFix('#{customer.firstName()}')).toBe('#{customer.firstName}');
    expect(applyFirstFix('#{#formatDat(order.placedAt, "d")}')).toBe('#{#formatDate(order.placedAt, "d")}');
    expect(applyFirstFix('#{order.items.?[price > order.total].size()}')).toBe(
      '#{order.items.?[price > #root.order.total].size()}',
    );
  });

  it('validateTemplate separates errors from warnings', () => {
    const result = validateTemplate('#{customer.loyalty.points} #{customer.nope}', MOCK_SCHEMA);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
  });
});

describe('evaluator', () => {
  it('evaluates ternaries, string concat and method calls', () => {
    expect(value("order.items.size() > 1 ? 'Your ' + order.items.size() + ' items' : 'Your item'")).toEqual({
      ok: true,
      value: 'Your 3 items',
    });
    expect(value('customer.firstName.toUpperCase().substring(0, 2)')).toEqual({ ok: true, value: 'AN' });
  });

  it('supports selection, first/last, projection and functions', () => {
    expect(value('order.items.?[onSale].![name]')).toEqual({ ok: true, value: ['Merino wool scarf', 'Wool socks (3-pack)'] });
    expect(value('order.items.^[quantity > 1].name')).toEqual({ ok: true, value: 'Leather gloves' });
    expect(value('order.items.$[onSale].name')).toEqual({ ok: true, value: 'Wool socks (3-pack)' });
    expect(value("#formatPrice(#sum(order.items.![price * quantity]), order.currency)")).toEqual({ ok: true, value: '€154.80' });
  });

  it('mirrors Java integer division and elvis on empty text', () => {
    expect(value('7 / 2')).toEqual({ ok: true, value: 3 });
    expect(value("'' ?: 'fallback'")).toEqual({ ok: true, value: 'fallback' });
  });

  it('fails like the server when reading a field of null', () => {
    const outcome = value('customer.loyalty.points', ben);
    expect(outcome).toMatchObject({ ok: false, kind: 'error' });
    expect(outcome.ok ? '' : outcome.message).toMatch(/customer.loyalty is empty/);
    expect(value('customer.loyalty?.points ?: 0', ben)).toEqual({ ok: true, value: 0 });
  });

  it('requires boolean conditions at runtime', () => {
    expect(value("customer.firstName ? 'a' : 'b'")).toMatchObject({ ok: false, message: expect.stringMatching(/true or false/) });
  });

  it('marks server-only functions as unsupported, not as errors', () => {
    expect(value('#trackingUrl(order.number)')).toMatchObject({ ok: false, kind: 'unsupported' });
  });
});

describe('renderTemplate', () => {
  it('renders a full message', () => {
    const result = render("Hi #{customer.firstName}, arriving #{#formatDate(order.estimatedDelivery, 'EEEE d MMMM')}.");
    expect(result.status).toBe('ok');
    expect(result.parts.map((part) => (part.kind === 'problem' ? '!' : part.text)).join('')).toBe(
      'Hi Anna, arriving Tuesday 10 November.',
    );
  });

  it('renders null as nothing, like CompositeStringExpression', () => {
    expect(render('[#{order.discountCode}]', ben).parts.map((p) => (p.kind === 'problem' ? '!' : p.text)).join('')).toBe('[]');
  });

  it('reports failed / invalid / partial status', () => {
    expect(render('#{customer.loyalty.points}', ben).status).toBe('failed');
    expect(render('#{customer.}').status).toBe('invalid');
    expect(render('#{#trackingUrl(order.number)}').status).toBe('partial');
  });
});

describe('completeExpression', () => {
  const labels = (prefix: string) =>
    completeExpression(prefix, 2, MOCK_SCHEMA)?.options.map((option) => option.label) ?? [];

  it('suggests fields of the receiver type', () => {
    expect(labels('customer.')).toEqual(expect.arrayContaining(['firstName', 'loyalty', 'tier']));
    expect(labels('customer.loyalty?.')).toEqual(['points', 'memberSince']);
  });

  it('suggests root fields and #functions at the start', () => {
    expect(labels('')).toEqual(expect.arrayContaining(['customer', 'order', '#formatDate']));
  });

  it('uses the item type inside filters', () => {
    expect(labels('order.items.?[')).toEqual(expect.arrayContaining(['price', 'onSale']));
  });

  it('suggests methods for built-in types and functions after #', () => {
    expect(labels('customer.firstName.')).toEqual(expect.arrayContaining(['toUpperCase', 'substring']));
    expect(labels('#form')).toEqual(expect.arrayContaining(['formatDate', 'formatPrice']));
  });

  it('works inside function arguments and returns the word start', () => {
    const result = completeExpression('#formatDate(order.pla', 2, MOCK_SCHEMA);
    expect(result?.from).toBe(2 + '#formatDate(order.'.length);
    expect(result?.options.map((o) => o.label)).toContain('placedAt');
  });

  it('returns nothing inside text literals', () => {
    expect(completeExpression("'abc", 0, MOCK_SCHEMA)).toBeNull();
  });
});

describe('explainExpression', () => {
  it('shows which ternary branch was taken and why', () => {
    const analysis = analyzeTemplate("#{customer.tier == 'GOLD' ? 'yes' : 'no'}", MOCK_SCHEMA);
    const ast = analysis.expressions[0]!.ast!;
    const { tree } = explainExpression(ast, { root: anna.data, schema: MOCK_SCHEMA, variables: {}, source: analysis.source });
    expect(tree.children.map((c) => [c.role, c.state.kind])).toEqual([
      ['if', 'value'],
      ['then', 'value'],
      ['else', 'skipped'],
    ]);
  });

  it('pinpoints the failing step in a chain', () => {
    const analysis = analyzeTemplate('#{customer.loyalty.points}', MOCK_SCHEMA);
    const ast = analysis.expressions[0]!.ast!;
    const { tree } = explainExpression(ast, { root: ben.data, schema: MOCK_SCHEMA, variables: {}, source: analysis.source });
    expect(tree.state.kind).toBe('error');
    expect(tree.children.map((c) => [c.source, c.state.kind])).toEqual([
      ['customer', 'value'],
      ['customer.loyalty', 'value'],
    ]);
  });
});
