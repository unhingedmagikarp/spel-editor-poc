export type BinaryOperator =
  | '+'
  | '-'
  | '*'
  | '/'
  | '%'
  | '^'
  | '=='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | 'and'
  | 'or'
  | 'matches'
  | 'between'
  | 'instanceof';

export type SelectionMode = 'all' | 'first' | 'last';

interface NodeBase {
  readonly from: number;
  readonly to: number;
}

export interface LiteralNode extends NodeBase {
  readonly type: 'literal';
  readonly value: string | number | boolean | null;
}

/** `name` on an object, or on the current context object when `object` is null. */
export interface MemberNode extends NodeBase {
  readonly type: 'member';
  readonly object: Node | null;
  readonly name: string;
  readonly nameFrom: number;
  readonly nameTo: number;
  readonly safe: boolean;
}

export interface MethodCallNode extends NodeBase {
  readonly type: 'methodCall';
  readonly object: Node | null;
  readonly name: string;
  readonly nameFrom: number;
  readonly nameTo: number;
  readonly args: readonly Node[];
  readonly safe: boolean;
}

/** `#name`, `#this`, `#root`. */
export interface VariableNode extends NodeBase {
  readonly type: 'variable';
  readonly name: string;
}

/** `#name(...)` — a registered function. */
export interface FunctionCallNode extends NodeBase {
  readonly type: 'functionCall';
  readonly name: string;
  readonly nameFrom: number;
  readonly nameTo: number;
  readonly args: readonly Node[];
}

export interface IndexNode extends NodeBase {
  readonly type: 'index';
  readonly object: Node | null;
  readonly index: Node;
}

/** `.?[...]`, `.^[...]`, `.$[...]` */
export interface SelectionNode extends NodeBase {
  readonly type: 'selection';
  readonly object: Node | null;
  readonly mode: SelectionMode;
  readonly predicate: Node;
  readonly safe: boolean;
  readonly openFrom: number;
  readonly openTo: number;
}

/** `.![...]` */
export interface ProjectionNode extends NodeBase {
  readonly type: 'projection';
  readonly object: Node | null;
  readonly expression: Node;
  readonly safe: boolean;
  readonly openFrom: number;
  readonly openTo: number;
}

export interface UnaryNode extends NodeBase {
  readonly type: 'unary';
  readonly operator: '!' | '-' | '+';
  readonly argument: Node;
}

export interface BinaryNode extends NodeBase {
  readonly type: 'binary';
  readonly operator: BinaryOperator;
  readonly left: Node;
  readonly right: Node;
  readonly operatorFrom: number;
  readonly operatorTo: number;
}

export interface TernaryNode extends NodeBase {
  readonly type: 'ternary';
  readonly test: Node;
  readonly consequent: Node;
  readonly alternate: Node;
}

/** `a ?: b` */
export interface ElvisNode extends NodeBase {
  readonly type: 'elvis';
  readonly left: Node;
  readonly right: Node;
}

export interface ListNode extends NodeBase {
  readonly type: 'list';
  readonly elements: readonly Node[];
}

export interface MapEntry {
  readonly key: string;
  readonly value: Node;
}

export interface MapNode extends NodeBase {
  readonly type: 'map';
  readonly entries: readonly MapEntry[];
}

/** `T(java.lang.Math)` */
export interface TypeRefNode extends NodeBase {
  readonly type: 'typeRef';
  readonly typeName: string;
}

/** `new java.util.Date()` */
export interface ConstructorNode extends NodeBase {
  readonly type: 'constructor';
  readonly typeName: string;
  readonly args: readonly Node[];
}

/** `@beanName` */
export interface BeanRefNode extends NodeBase {
  readonly type: 'beanRef';
  readonly name: string;
}

export interface AssignNode extends NodeBase {
  readonly type: 'assign';
  readonly target: Node;
  readonly value: Node;
  readonly operatorFrom: number;
  readonly operatorTo: number;
}

/** Placeholder produced only in lenient (autocomplete) parsing when input ends early. */
export interface MissingNode extends NodeBase {
  readonly type: 'missing';
}

export type Node =
  | LiteralNode
  | MemberNode
  | MethodCallNode
  | VariableNode
  | FunctionCallNode
  | IndexNode
  | SelectionNode
  | ProjectionNode
  | UnaryNode
  | BinaryNode
  | TernaryNode
  | ElvisNode
  | ListNode
  | MapNode
  | TypeRefNode
  | ConstructorNode
  | BeanRefNode
  | AssignNode
  | MissingNode;

/** Nodes that read from an object: `a.b`, `a.b()`, `a[0]`, `a.?[..]`, `a.![..]`. */
export type ChainNode = MemberNode | MethodCallNode | IndexNode | SelectionNode | ProjectionNode;

export function isChainNode(node: Node): node is ChainNode {
  return (
    node.type === 'member' ||
    node.type === 'methodCall' ||
    node.type === 'index' ||
    node.type === 'selection' ||
    node.type === 'projection'
  );
}
