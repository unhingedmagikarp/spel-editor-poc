import { describe, expect, it } from 'vitest';
import { tokenize } from './lexer';
import { parseTokens } from './parser';
import { splitTemplate } from './template';

const parse = (src: string) => parseTokens(tokenize(src).tokens);

describe('splitTemplate', () => {
  it('splits text and expressions with absolute positions', () => {
    const { segments, diagnostics } = splitTemplate('Hi #{name}!');
    expect(diagnostics).toEqual([]);
    expect(segments).toMatchObject([
      { kind: 'text', text: 'Hi ', from: 0, to: 3 },
      { kind: 'expr', body: 'name', from: 3, to: 10, bodyFrom: 5, bodyTo: 9, closed: true },
      { kind: 'text', text: '!' },
    ]);
  });

  it('ignores } inside strings and inline lists', () => {
    const { segments } = splitTemplate("#{'a}b' + {1,2}.size()} end");
    expect(segments[0]).toMatchObject({ kind: 'expr', body: "'a}b' + {1,2}.size()", closed: true });
    expect(segments[1]).toMatchObject({ kind: 'text', text: ' end' });
  });

  it('closes the expression at } even when a ( is still open', () => {
    const { segments } = splitTemplate('#{f(a} tail');
    expect(segments[0]).toMatchObject({ body: 'f(a', closed: true });
  });

  it('reports an unclosed #{', () => {
    const { segments, diagnostics } = splitTemplate('Hi #{name and more');
    expect(segments[1]).toMatchObject({ kind: 'expr', closed: false, bodyTo: 18 });
    expect(diagnostics[0]?.message).toMatch(/never closed/);
  });

  it('reports an empty expression', () => {
    expect(splitTemplate('#{  }').diagnostics[0]?.message).toMatch(/Empty expression/);
  });
});

describe('tokenize', () => {
  it('handles operators, strings with escaped quotes and offsets', () => {
    const { tokens, diagnostics } = tokenize("a?.b ?: 'it''s'", 10);
    expect(diagnostics).toEqual([]);
    expect(tokens.map((tok) => tok.kind)).toEqual(['identifier', 'safeNav', 'identifier', 'elvis', 'string', 'eof']);
    expect(tokens[4]).toMatchObject({ value: "it's", from: 18 });
  });

  it('lexes selection/projection tokens', () => {
    const kinds = tokenize('a.?[x].![y].^[z].$[w]').tokens.map((tok) => tok.kind);
    expect(kinds).toContain('select');
    expect(kinds).toContain('project');
    expect(kinds).toContain('selectFirst');
    expect(kinds).toContain('selectLast');
  });

  it('reports unterminated strings', () => {
    expect(tokenize("'abc").diagnostics[0]?.message).toMatch(/never closed/);
  });
});

describe('parseTokens', () => {
  it('respects precedence: ternary < or < and < comparison < sum < product', () => {
    const { ast } = parse('a > 1 and b or c ? x + y * 2 : z');
    expect(ast).toMatchObject({
      type: 'ternary',
      test: { type: 'binary', operator: 'or', left: { type: 'binary', operator: 'and' } },
      consequent: { type: 'binary', operator: '+', right: { type: 'binary', operator: '*' } },
    });
  });

  it('parses chains with safe navigation, methods, index, selection and projection', () => {
    const { ast } = parse("order.items.?[price > 10].![name.toUpperCase()][0]?.length()");
    expect(ast).toMatchObject({
      type: 'methodCall',
      name: 'length',
      safe: true,
      object: { type: 'index', object: { type: 'projection', object: { type: 'selection', mode: 'all' } } },
    });
  });

  it('parses functions, variables, elvis and textual operators', () => {
    expect(parse("#fmt(#this.x, 'p') ?: 'none'").ast).toMatchObject({
      type: 'elvis',
      left: { type: 'functionCall', name: 'fmt', args: [{ type: 'member' }, { type: 'literal', value: 'p' }] },
    });
    // unary binds tighter than comparison, as in Spring
    expect(parse('not a eq b').ast).toMatchObject({ type: 'binary', operator: '==', left: { type: 'unary' } });
  });

  it('parses inline lists, maps, T() and between', () => {
    expect(parse('x between {1, 5}').ast).toMatchObject({ type: 'binary', operator: 'between', right: { type: 'list' } });
    expect(parse("{name: 'a'}").ast).toMatchObject({ type: 'map', entries: [{ key: 'name' }] });
    expect(parse('T(java.lang.Math).max(1, 2)').ast).toMatchObject({ type: 'methodCall', object: { type: 'typeRef', typeName: 'java.lang.Math' } });
  });

  it.each([
    ['a +', /missing after '\+'/],
    ['f(a', /'\(' is never closed/],
    ['a ? b', /missing its ':'/],
    ['a b', /Missing operator/],
    ['a.', /field or method name/],
    ['a)', /extra '\)'/],
    ['items?[x]', /Put a dot/],
  ])('reports a friendly error for %s', (src, message) => {
    const { ast, diagnostics } = parse(src);
    expect(ast).toBeNull();
    expect(diagnostics[0]?.message).toMatch(message);
  });

  it('tolerates early end of input in lenient mode', () => {
    const { ast } = parseTokens(tokenize('f(a.b').tokens, { lenientEof: true });
    expect(ast).toMatchObject({ type: 'methodCall', args: [{ type: 'member', name: 'b' }] });
  });
});
