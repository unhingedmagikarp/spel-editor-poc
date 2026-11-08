import type { BinaryOperator, MapEntry, Node, SelectionMode } from './ast';
import type { Token, TokenKind } from './lexer';
import { diagnostic, own, type SpelDiagnostic } from './types';

/**
 * Recursive-descent parser following Spring's InternalSpelExpressionParser precedence:
 *   expression  := logicalOr ( '=' logicalOr | '?:' expression | '?' expression ':' expression )?
 *   logicalOr   := logicalAnd ( ('or' | '||') logicalAnd )*
 *   logicalAnd  := relational ( ('and' | '&&') relational )*
 *   relational  := sum ( relOp sum )?
 *   sum         := product ( ('+' | '-') product )*
 *   product     := power ( ('*' | '/' | '%' | 'div' | 'mod') power )*
 *   power       := unary ( '^' unary )?
 *   unary       := ('!' | 'not' | '-' | '+') unary | primary
 *   primary     := startNode ( ('.' | '?.') dotted | '[' expression ']' )*
 */

export interface ParseOptions {
  /** Tolerate input that ends early (used for autocomplete on a half-typed expression). */
  readonly lenientEof?: boolean;
}

export interface ParseResult {
  readonly ast: Node | null;
  readonly diagnostics: readonly SpelDiagnostic[];
}

class ParseError extends Error {
  constructor(
    message: string,
    readonly from: number,
    readonly to: number,
  ) {
    super(message);
  }
}

const RELATIONAL_TOKENS: Partial<Record<TokenKind, BinaryOperator>> = {
  eq: '==',
  ne: '!=',
  lt: '<',
  le: '<=',
  gt: '>',
  ge: '>=',
};

const RELATIONAL_WORDS: Readonly<Record<string, BinaryOperator>> = {
  eq: '==',
  ne: '!=',
  lt: '<',
  le: '<=',
  gt: '>',
  ge: '>=',
  matches: 'matches',
  between: 'between',
  instanceof: 'instanceof',
};

const SELECTION_MODES: Partial<Record<TokenKind, SelectionMode>> = {
  select: 'all',
  selectFirst: 'first',
  selectLast: 'last',
};

const VALUE_START: ReadonlySet<TokenKind> = new Set<TokenKind>([
  'number',
  'string',
  'identifier',
  'hash',
  'at',
  'lparen',
  'lbrace',
]);

export function parseTokens(tokens: readonly Token[], options: ParseOptions = {}): ParseResult {
  try {
    const ast = new Parser(tokens, options.lenientEof ?? false).parseRoot();
    return { ast, diagnostics: [] };
  } catch (error: unknown) {
    if (error instanceof ParseError) {
      return { ast: null, diagnostics: [diagnostic('error', error.message, error.from, error.to)] };
    }
    throw error;
  }
}

class Parser {
  private index = 0;

  constructor(
    private readonly tokens: readonly Token[],
    private readonly lenient: boolean,
  ) {}

  parseRoot(): Node {
    const expr = this.expression();
    const tok = this.peek();
    if (tok.kind !== 'eof') throw this.unexpectedAfterValue(tok);
    return expr;
  }

  // ---- token helpers -------------------------------------------------------

  private peek(ahead = 0): Token {
    const tok = this.tokens[Math.min(this.index + ahead, this.tokens.length - 1)];
    if (!tok) throw new ParseError('Internal error: no tokens', 0, 0);
    return tok;
  }

  private previous(): Token | undefined {
    return this.tokens[this.index - 1];
  }

  private next(): Token {
    const tok = this.peek();
    if (tok.kind !== 'eof') this.index++;
    return tok;
  }

  private is(kind: TokenKind): boolean {
    return this.peek().kind === kind;
  }

  private isWord(word: string): boolean {
    const tok = this.peek();
    return tok.kind === 'identifier' && tok.text.toLowerCase() === word;
  }

  private canEndEarly(): boolean {
    return this.lenient && this.is('eof');
  }

  private missing(): Node {
    const at = this.peek().from;
    return { type: 'missing', from: at, to: at };
  }

  private expectClosing(kind: TokenKind, closer: string, opener: Token): Token {
    const tok = this.peek();
    if (tok.kind === kind) return this.next();
    if (this.canEndEarly()) return tok;
    if (tok.kind === 'eof') {
      throw new ParseError(`This '${opener.text}' is never closed — add '${closer}'.`, opener.from, opener.to);
    }
    throw new ParseError(`Expected '${closer}' to close the '${opener.text}', but found '${tok.text}'.`, tok.from, tok.to);
  }

  private unexpectedAfterValue(tok: Token): ParseError {
    if (tok.kind === 'rparen' || tok.kind === 'rbracket' || tok.kind === 'rbrace') {
      return new ParseError(`There's an extra '${tok.text}' with nothing to close.`, tok.from, tok.to);
    }
    if (tok.kind === 'colon') {
      return new ParseError("Found ':' without a '?' before it — write it as condition ? a : b.", tok.from, tok.to);
    }
    if (tok.kind === 'select' || tok.kind === 'project' || tok.kind === 'selectFirst' || tok.kind === 'selectLast') {
      return new ParseError(`Put a dot before '${tok.text}' — for example items.${tok.text} … ].`, tok.from, tok.to);
    }
    if (VALUE_START.has(tok.kind)) {
      return new ParseError(
        `Missing operator before '${tok.text}' — two values can't sit next to each other. Use + to join text.`,
        tok.from,
        tok.to,
      );
    }
    return new ParseError(`Unexpected '${tok.text}' here.`, tok.from, tok.to);
  }

  // ---- grammar -------------------------------------------------------------

  private expression(): Node {
    const left = this.logicalOr();
    const tok = this.peek();
    if (tok.kind === 'assign') {
      this.next();
      const value = this.logicalOr();
      return { type: 'assign', target: left, value, operatorFrom: tok.from, operatorTo: tok.to, from: left.from, to: value.to };
    }
    if (tok.kind === 'elvis') {
      this.next();
      const right = this.expression();
      return { type: 'elvis', left, right, from: left.from, to: right.to };
    }
    if (tok.kind === 'question') return this.ternary(left, tok);
    return left;
  }

  private ternary(test: Node, question: Token): Node {
    this.next();
    const consequent = this.expression();
    if (!this.is('colon')) {
      if (this.canEndEarly()) {
        const alternate = this.missing();
        return { type: 'ternary', test, consequent, alternate, from: test.from, to: consequent.to };
      }
      throw new ParseError(
        "This condition is missing its ':' part — write it as condition ? valueIfTrue : valueIfFalse.",
        question.from,
        question.to,
      );
    }
    this.next();
    const alternate = this.expression();
    return { type: 'ternary', test, consequent, alternate, from: test.from, to: alternate.to };
  }

  private binary(operator: BinaryOperator, left: Node, opToken: Token, right: Node): Node {
    return {
      type: 'binary',
      operator,
      left,
      right,
      operatorFrom: opToken.from,
      operatorTo: opToken.to,
      from: left.from,
      to: right.to,
    };
  }

  private logicalOr(): Node {
    let left = this.logicalAnd();
    while (this.is('or') || this.isWord('or')) {
      const op = this.next();
      left = this.binary('or', left, op, this.logicalAnd());
    }
    return left;
  }

  private logicalAnd(): Node {
    let left = this.relational();
    while (this.is('and') || this.isWord('and')) {
      const op = this.next();
      left = this.binary('and', left, op, this.relational());
    }
    return left;
  }

  private relational(): Node {
    const left = this.sum();
    const tok = this.peek();
    const operator =
      RELATIONAL_TOKENS[tok.kind] ?? (tok.kind === 'identifier' ? own(RELATIONAL_WORDS, tok.text.toLowerCase()) : undefined);
    if (!operator) return left;
    this.next();
    return this.binary(operator, left, tok, this.sum());
  }

  private sum(): Node {
    let left = this.product();
    while (this.is('plus') || this.is('minus')) {
      const op = this.next();
      left = this.binary(op.kind === 'plus' ? '+' : '-', left, op, this.product());
    }
    return left;
  }

  private productOperator(): BinaryOperator | null {
    if (this.is('star')) return '*';
    if (this.is('slash') || this.isWord('div')) return '/';
    if (this.is('percent') || this.isWord('mod')) return '%';
    return null;
  }

  private product(): Node {
    let left = this.power();
    for (let op = this.productOperator(); op; op = this.productOperator()) {
      const tok = this.next();
      left = this.binary(op, left, tok, this.power());
    }
    return left;
  }

  private power(): Node {
    const left = this.unary();
    if (!this.is('caret')) return left;
    const op = this.next();
    return this.binary('^', left, op, this.unary());
  }

  private unary(): Node {
    const tok = this.peek();
    const operator = tok.kind === 'not' || this.isWord('not') ? '!' : tok.kind === 'minus' ? '-' : tok.kind === 'plus' ? '+' : null;
    if (!operator) return this.primary();
    this.next();
    const argument = this.unary();
    return { type: 'unary', operator, argument, from: tok.from, to: argument.to };
  }

  private primary(): Node {
    let node = this.startNode();
    for (;;) {
      const tok = this.peek();
      if (tok.kind === 'dot' || tok.kind === 'safeNav') {
        this.next();
        node = this.dotted(node, tok);
      } else if (tok.kind === 'lbracket') {
        node = this.indexer(node);
      } else {
        return node;
      }
    }
  }

  private startNode(): Node {
    const tok = this.peek();
    switch (tok.kind) {
      case 'number':
        this.next();
        return { type: 'literal', value: typeof tok.value === 'number' ? tok.value : Number(tok.text), from: tok.from, to: tok.to };
      case 'string':
        this.next();
        return { type: 'literal', value: typeof tok.value === 'string' ? tok.value : '', from: tok.from, to: tok.to };
      case 'lparen':
        return this.parenthesized();
      case 'identifier':
        return this.identifierStart(tok);
      case 'hash':
        return this.functionOrVariable();
      case 'at':
        return this.beanReference();
      case 'lbrace':
        return this.inlineCollection();
      case 'select':
      case 'selectFirst':
      case 'selectLast':
        return this.selection(null, false);
      case 'project':
        return this.projection(null, false);
      case 'lbracket':
        return this.indexer(null);
      case 'eof':
        if (this.lenient) return this.missing();
        throw this.endsTooEarly();
      default:
        throw new ParseError(`Expected a value but found '${tok.text}'.`, tok.from, tok.to);
    }
  }

  private endsTooEarly(): ParseError {
    const prev = this.previous();
    if (!prev) return new ParseError('The expression is empty.', this.peek().from, this.peek().to);
    return new ParseError(`Something is missing after '${prev.text}'.`, prev.from, prev.to);
  }

  private parenthesized(): Node {
    const open = this.next();
    const inner = this.expression();
    const close = this.expectClosing('rparen', ')', open);
    return { ...inner, from: open.from, to: close.to };
  }

  private identifierStart(tok: Token): Node {
    const lower = tok.text.toLowerCase();
    if (lower === 'true' || lower === 'false') {
      this.next();
      return { type: 'literal', value: lower === 'true', from: tok.from, to: tok.to };
    }
    if (lower === 'null') {
      this.next();
      return { type: 'literal', value: null, from: tok.from, to: tok.to };
    }
    if (tok.text === 'T' && this.peek(1).kind === 'lparen') return this.typeReference();
    if (lower === 'new' && this.peek(1).kind === 'identifier') return this.constructorReference();
    return this.methodOrProperty(null, false);
  }

  private dotted(object: Node, dot: Token): Node {
    const safe = dot.kind === 'safeNav';
    const tok = this.peek();
    if (tok.kind === 'identifier') return this.methodOrProperty(object, safe);
    if (SELECTION_MODES[tok.kind]) return this.selection(object, safe);
    if (tok.kind === 'project') return this.projection(object, safe);
    if (this.canEndEarly()) {
      return { type: 'member', object, name: '', nameFrom: tok.from, nameTo: tok.to, safe, from: object.from, to: tok.to };
    }
    if (tok.kind === 'eof') {
      throw new ParseError(`Expected a field or method name after '${dot.text}'.`, dot.from, dot.to);
    }
    throw new ParseError(`Expected a field or method name after '${dot.text}', but found '${tok.text}'.`, tok.from, tok.to);
  }

  private methodOrProperty(object: Node | null, safe: boolean): Node {
    const name = this.next();
    const from = object ? object.from : name.from;
    if (!this.is('lparen')) {
      return { type: 'member', object, name: name.text, nameFrom: name.from, nameTo: name.to, safe, from, to: name.to };
    }
    const { args, end } = this.argumentList();
    return { type: 'methodCall', object, name: name.text, nameFrom: name.from, nameTo: name.to, args, safe, from, to: end };
  }

  private argumentList(): { readonly args: readonly Node[]; readonly end: number } {
    const open = this.next();
    const args: Node[] = [];
    if (!this.is('rparen')) {
      for (;;) {
        if (this.canEndEarly()) break;
        args.push(this.expression());
        if (!this.is('comma')) break;
        this.next();
      }
    }
    const close = this.expectClosing('rparen', ')', open);
    return { args, end: close.to };
  }

  private selection(object: Node | null, safe: boolean): Node {
    const open = this.next();
    const mode = SELECTION_MODES[open.kind] ?? 'all';
    const predicate = this.expression();
    const close = this.expectClosing('rbracket', ']', open);
    return {
      type: 'selection',
      object,
      mode,
      predicate,
      safe,
      openFrom: open.from,
      openTo: open.to,
      from: object ? object.from : open.from,
      to: close.to,
    };
  }

  private projection(object: Node | null, safe: boolean): Node {
    const open = this.next();
    const expression = this.expression();
    const close = this.expectClosing('rbracket', ']', open);
    return {
      type: 'projection',
      object,
      expression,
      safe,
      openFrom: open.from,
      openTo: open.to,
      from: object ? object.from : open.from,
      to: close.to,
    };
  }

  private indexer(object: Node | null): Node {
    const open = this.next();
    const index = this.expression();
    const close = this.expectClosing('rbracket', ']', open);
    return { type: 'index', object, index, from: object ? object.from : open.from, to: close.to };
  }

  private functionOrVariable(): Node {
    const hash = this.next();
    const name = this.peek();
    if (name.kind !== 'identifier') {
      if (this.canEndEarly()) return { type: 'variable', name: '', from: hash.from, to: hash.to };
      if (name.kind === 'lbrace') {
        throw new ParseError("'#{' can't go inside another expression — you're already inside #{ }.", hash.from, name.to);
      }
      throw new ParseError("Expected a variable or function name after '#'.", hash.from, hash.to);
    }
    this.next();
    if (!this.is('lparen')) return { type: 'variable', name: name.text, from: hash.from, to: name.to };
    const { args, end } = this.argumentList();
    return { type: 'functionCall', name: name.text, nameFrom: name.from, nameTo: name.to, args, from: hash.from, to: end };
  }

  private beanReference(): Node {
    const at = this.next();
    const name = this.peek();
    if (name.kind !== 'identifier' && name.kind !== 'string') {
      throw new ParseError("Expected a bean name after '@'.", at.from, at.to);
    }
    this.next();
    return { type: 'beanRef', name: String(name.value ?? name.text), from: at.from, to: name.to };
  }

  private qualifiedName(): { readonly name: string; readonly to: number } {
    const parts: string[] = [];
    let to = this.peek().from;
    for (;;) {
      const part = this.peek();
      if (part.kind !== 'identifier') throw new ParseError('Expected a type name.', part.from, part.to);
      this.next();
      parts.push(part.text);
      to = part.to;
      if (!this.is('dot')) return { name: parts.join('.'), to };
      this.next();
    }
  }

  private typeReference(): Node {
    const t = this.next();
    const open = this.next();
    const { name } = this.qualifiedName();
    const close = this.expectClosing('rparen', ')', open);
    return { type: 'typeRef', typeName: name, from: t.from, to: close.to };
  }

  private constructorReference(): Node {
    const keyword = this.next();
    const { name, to } = this.qualifiedName();
    if (!this.is('lparen')) return { type: 'constructor', typeName: name, args: [], from: keyword.from, to };
    const { args, end } = this.argumentList();
    return { type: 'constructor', typeName: name, args, from: keyword.from, to: end };
  }

  private inlineCollection(): Node {
    const open = this.next();
    if (this.is('rbrace')) {
      const close = this.next();
      return { type: 'list', elements: [], from: open.from, to: close.to };
    }
    if (this.is('colon')) {
      this.next();
      const close = this.expectClosing('rbrace', '}', open);
      return { type: 'map', entries: [], from: open.from, to: close.to };
    }
    const first = this.expression();
    if (this.is('colon')) return this.inlineMap(open, first);
    const elements: Node[] = [first];
    while (this.is('comma')) {
      this.next();
      elements.push(this.expression());
    }
    const close = this.expectClosing('rbrace', '}', open);
    return { type: 'list', elements, from: open.from, to: close.to };
  }

  private inlineMap(open: Token, firstKey: Node): Node {
    const entries: MapEntry[] = [];
    let key: Node = firstKey;
    for (;;) {
      this.next(); // ':'
      entries.push({ key: mapKey(key), value: this.expression() });
      if (!this.is('comma')) break;
      this.next();
      key = this.expression();
      if (!this.is('colon')) throw new ParseError("Expected ':' after the map key.", key.from, key.to);
    }
    const close = this.expectClosing('rbrace', '}', open);
    return { type: 'map', entries, from: open.from, to: close.to };
  }
}

/** In inline maps, bare identifiers are literal keys: `{name: 'x'}`. */
function mapKey(node: Node): string {
  if (node.type === 'literal') return String(node.value);
  if (node.type === 'member' && node.object === null) return node.name;
  throw new ParseError('Map keys must be plain names or text.', node.from, node.to);
}
