/**
 * What a Function block's `result` fields hold, read from the object literal its JavaScript code
 * returns (`return { total: subtotal + tax, tier: 'gold' }`), so a bare reference to one in a JSON
 * field is not reported as untyped when the code says it is a number, boolean, array or object.
 *
 * The reading is deliberately narrow: every `return` outside a nested function must return an
 * object literal, and a field counts only when each of them sets it to an expression whose kind
 * is certain (a literal, arithmetic, a comparison, `String(…)`, the `.length` of a string or an
 * array, a local variable never
 * reassigned to another kind, …). Anything else stays unknown, and the reference keeps its
 * warning: a wrong "typed" would store a string bare and break the JSON at run time.
 */

import { parse } from '@babel/parser'
import type { Expression, Node, ObjectExpression, PatternLike } from '@babel/types'
import { childNodes, memberName } from '../babel'
import { parseStoredPath } from '../code-files/ref-path'
import { toCodeFile } from '../code-files/to-file'
import type { BlockKey, CanonicalBlock } from '../model'
import { getOwn } from '../records'

/** A value's kind as far as JSON splicing goes: text, or any other JSON value. */
export type ReturnedKind = 'string' | 'typed'

/** The JavaScript kinds an expression can be inferred to have; `typed` is a mix of non-strings. */
type JsKind = 'string' | 'number' | 'boolean' | 'typed'

const FUNCTION_TYPE = 'function'

const NUMBER_FUNCTIONS: ReadonlySet<string> = new Set(['Number', 'parseInt', 'parseFloat'])
const BOOLEAN_FUNCTIONS: ReadonlySet<string> = new Set(['Boolean', 'isNaN', 'isFinite'])
const STRING_METHODS: ReadonlySet<string> = new Set([
  'toFixed',
  'toPrecision',
  'toString',
  'toUpperCase',
  'toLowerCase',
  'trim',
  'trimStart',
  'trimEnd',
  'padStart',
  'padEnd',
  'repeat',
  'toISOString',
  'toLocaleString',
  'join',
  'charAt',
  'replace',
  'replaceAll',
  'normalize',
  'substring',
])
const BOOLEAN_METHODS: ReadonlySet<string> = new Set([
  'includes',
  'startsWith',
  'endsWith',
  'some',
  'every',
  'test',
  'hasOwnProperty',
])
const NUMBER_METHODS: ReadonlySet<string> = new Set([
  'indexOf',
  'lastIndexOf',
  'findIndex',
  'getTime',
  'charCodeAt',
])
const ARRAY_METHODS: ReadonlySet<string> = new Set(['map', 'filter', 'split', 'flat', 'flatMap'])
const STATIC_KINDS: Readonly<Record<string, JsKind>> = {
  'Number.isFinite': 'boolean',
  'Number.isInteger': 'boolean',
  'Number.isNaN': 'boolean',
  'Number.isSafeInteger': 'boolean',
  'Number.parseFloat': 'number',
  'Number.parseInt': 'number',
  'Array.isArray': 'boolean',
  'Object.keys': 'typed',
  'Object.values': 'typed',
  'Object.entries': 'typed',
  'JSON.stringify': 'string',
  'Date.now': 'number',
}
const ARITHMETIC: ReadonlySet<string> = new Set([
  '-',
  '*',
  '/',
  '%',
  '**',
  '|',
  '&',
  '^',
  '<<',
  '>>',
  '>>>',
])
const COMPARISON: ReadonlySet<string> = new Set([
  '==',
  '===',
  '!=',
  '!==',
  '<',
  '<=',
  '>',
  '>=',
  'in',
  'instanceof',
])

/** Each function block's returned field kinds, read once per compiled block object. */
const cache = new WeakMap<CanonicalBlock, ReadonlyMap<string, ReturnedKind> | null>()

function isFunctionNode(node: Node): boolean {
  return (
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression' ||
    node.type === 'ObjectMethod' ||
    node.type === 'ClassMethod' ||
    node.type === 'ClassPrivateMethod'
  )
}

/** Every node under `root`, calling `visit` on each; `enterFunctions` false skips nested bodies. */
function walk(root: Node, enterFunctions: boolean, visit: (node: Node) => void): void {
  const stack: Node[] = [root]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node) break
    visit(node)
    if (!enterFunctions && node !== root && isFunctionNode(node)) continue
    stack.push(...childNodes(node))
  }
}

/** The names a declaration pattern binds; `null` for a destructuring, whose kinds are unknown. */
function boundName(pattern: PatternLike | Node): string | null {
  return pattern.type === 'Identifier' ? pattern.name : null
}

/** The local variables of the code and what each is set to, for {@link Inference.identifier}. */
interface Bindings {
  /** The initializer of each name declared once with one; `null` for any other declaration. */
  initial: Map<string, Expression | null>
  /** Every assignment to each name, anywhere in the code (callbacks included). */
  writes: Map<string, Array<{ operator: string; value: Expression | null }>>
}

function collectBindings(program: Node): Bindings {
  const initial = new Map<string, Expression | null>()
  const writes = new Map<string, Array<{ operator: string; value: Expression | null }>>()
  const declare = (name: string, value: Expression | null) => {
    initial.set(name, initial.has(name) ? null : value)
  }
  walk(program, true, (node) => {
    if (node.type === 'VariableDeclarator') {
      const name = boundName(node.id)
      if (name !== null) declare(name, node.init ?? null)
      else for (const child of childNodes(node.id)) walkPatternNames(child, (n) => declare(n, null))
    } else if (node.type === 'FunctionDeclaration' && node.id) {
      declare(node.id.name, null)
    } else if (isFunctionNode(node) && 'params' in node) {
      for (const param of node.params) walkPatternNames(param, (n) => declare(n, null))
    } else if (node.type === 'CatchClause' && node.param) {
      walkPatternNames(node.param, (n) => declare(n, null))
    } else if (node.type === 'AssignmentExpression' && node.left.type === 'Identifier') {
      const list = writes.get(node.left.name) ?? []
      list.push({ operator: node.operator, value: node.right })
      writes.set(node.left.name, list)
    } else if (node.type === 'AssignmentExpression') {
      walkPatternNames(node.left, (n) => {
        const list = writes.get(n) ?? []
        list.push({ operator: '=', value: null })
        writes.set(n, list)
      })
    } else if (
      (node.type === 'ForOfStatement' || node.type === 'ForInStatement') &&
      node.left.type !== 'VariableDeclaration'
    ) {
      // `for (x of …)` reassigns an existing `x` each pass, with no assignment expression.
      walkPatternNames(node.left, (n) => {
        const list = writes.get(n) ?? []
        list.push({ operator: '=', value: null })
        writes.set(n, list)
      })
    } else if (node.type === 'UpdateExpression' && node.argument.type === 'Identifier') {
      const list = writes.get(node.argument.name) ?? []
      list.push({ operator: '++', value: null })
      writes.set(node.argument.name, list)
    }
  })
  return { initial, writes }
}

/** Calls `found` with every identifier a pattern binds. */
function walkPatternNames(pattern: Node, found: (name: string) => void): void {
  walk(pattern, false, (node) => {
    if (node.type === 'Identifier') found(node.name)
  })
}

/** Two kinds of the same value (both branches of `a ? b : c`), as one kind, or unknown. */
function merge(a: JsKind | undefined, b: JsKind | undefined): JsKind | undefined {
  if (a === undefined || b === undefined) return undefined
  if (a === b) return a
  return a !== 'string' && b !== 'string' ? 'typed' : undefined
}

/** Infers expression kinds over one program's bindings, guarding against self-reference. */
class Inference {
  private readonly resolving = new Set<string>()

  constructor(private readonly bindings: Bindings) {}

  kind(node: Node | null | undefined): JsKind | undefined {
    if (!node) return undefined
    switch (node.type) {
      case 'NumericLiteral':
      case 'BigIntLiteral':
        return 'number'
      case 'StringLiteral':
      case 'TemplateLiteral':
        return 'string'
      case 'BooleanLiteral':
        return 'boolean'
      case 'NullLiteral':
      case 'ArrayExpression':
      case 'ObjectExpression':
        return 'typed'
      case 'UnaryExpression':
        if (node.operator === '!' || node.operator === 'delete') return 'boolean'
        if (node.operator === 'typeof') return 'string'
        if (node.operator === '-' || node.operator === '+' || node.operator === '~') return 'number'
        return undefined
      case 'BinaryExpression':
        return this.binary(node.operator, node.left, node.right)
      case 'LogicalExpression':
        return merge(this.kind(node.left), this.kind(node.right))
      case 'ConditionalExpression':
        return merge(this.kind(node.consequent), this.kind(node.alternate))
      case 'SequenceExpression':
        return this.kind(node.expressions.at(-1))
      case 'AssignmentExpression':
        return node.operator === '=' ? this.kind(node.right) : undefined
      case 'UpdateExpression':
        return 'number'
      case 'MemberExpression':
      case 'OptionalMemberExpression':
        return memberName(node) === 'length' &&
          (this.kind(node.object) === 'string' || this.isArray(node.object))
          ? 'number'
          : undefined
      case 'CallExpression':
      case 'OptionalCallExpression':
        return this.call(node.callee)
      case 'Identifier':
        return this.identifier(node.name)
      default:
        return undefined
    }
  }

  private binary(operator: string, left: Node, right: Node): JsKind | undefined {
    if (COMPARISON.has(operator)) return 'boolean'
    if (ARITHMETIC.has(operator)) return 'number'
    if (operator !== '+') return undefined
    const [a, b] = [this.kind(left), this.kind(right)]
    if (a === 'string' || b === 'string') return 'string'
    return a === 'number' && b === 'number' ? 'number' : undefined
  }

  private call(callee: Node): JsKind | undefined {
    if (callee.type === 'Identifier') {
      if (callee.name === 'String') return 'string'
      if (NUMBER_FUNCTIONS.has(callee.name)) return 'number'
      if (BOOLEAN_FUNCTIONS.has(callee.name)) return 'boolean'
      return undefined
    }
    const method = memberName(callee)
    if (method === null || !('object' in callee)) return undefined
    if (callee.object.type === 'Identifier') {
      if (callee.object.name === 'Math') return 'number'
      const known = STATIC_KINDS[`${callee.object.name}.${method}`]
      if (known) return known
    }
    if (STRING_METHODS.has(method)) return 'string'
    if (BOOLEAN_METHODS.has(method)) return 'boolean'
    if (NUMBER_METHODS.has(method)) return 'number'
    if (ARRAY_METHODS.has(method)) return 'typed'
    return undefined
  }

  /**
   * Whether `node` is certainly an array: a literal, an array method's result, `Object.keys`
   * (`values`, `entries`), or a local variable set to one and never reassigned. Any other object
   * can hold anything under `length`.
   */
  private isArray(node: Node): boolean {
    if (node.type === 'ArrayExpression') return true
    if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
      const method = memberName(node.callee)
      if (method === null || !('object' in node.callee)) return false
      if (node.callee.object.type === 'Identifier' && node.callee.object.name === 'Object') {
        return method === 'keys' || method === 'values' || method === 'entries'
      }
      return ARRAY_METHODS.has(method)
    }
    if (node.type !== 'Identifier') return false
    const init = this.bindings.initial.get(node.name)
    if (!init || this.bindings.writes.has(node.name) || this.resolving.has(node.name)) return false
    this.resolving.add(node.name)
    try {
      return this.isArray(init)
    } finally {
      this.resolving.delete(node.name)
    }
  }

  /**
   * A local variable's kind: its initializer's, kept only when every later assignment keeps it
   * (`+=` of a number to a number, of anything to a string; `++`; `=` of the same kind).
   */
  private identifier(name: string): JsKind | undefined {
    const init = this.bindings.initial.get(name)
    if (!init || this.resolving.has(name)) return undefined
    this.resolving.add(name)
    try {
      const declared = this.kind(init)
      if (declared === undefined) return undefined
      for (const { operator, value } of this.bindings.writes.get(name) ?? []) {
        if (operator === '++') {
          if (declared !== 'number') return undefined
        } else if (operator === '=') {
          if (merge(declared, this.kind(value)) !== declared) return undefined
        } else if (operator === '+=') {
          const added = this.kind(value)
          if (!(declared === 'string' || (declared === 'number' && added === 'number'))) {
            return undefined
          }
        } else if (ARITHMETIC.has(operator.slice(0, -1))) {
          if (declared !== 'number') return undefined
        } else {
          return undefined
        }
      }
      return declared
    } finally {
      this.resolving.delete(name)
    }
  }
}

/**
 * The fields one returned object literal sets, by name. A spread, or a key not known statically
 * (computed, or any other key syntax), may replace any field before it, so it makes earlier ones
 * unknown; a method or accessor makes its own field unknown.
 */
function returnedFields(
  object: ObjectExpression,
  inference: Inference
): Map<string, JsKind | undefined> {
  const fields = new Map<string, JsKind | undefined>()
  for (const property of object.properties) {
    const key =
      property.type === 'SpreadElement' || property.computed
        ? null
        : property.key.type === 'Identifier'
          ? property.key.name
          : property.key.type === 'StringLiteral'
            ? property.key.value
            : property.key.type === 'NumericLiteral'
              ? String(property.key.value)
              : null
    if (key === null) {
      for (const known of fields.keys()) fields.set(known, undefined)
      continue
    }
    fields.set(key, property.type === 'ObjectProperty' ? inference.kind(property.value) : undefined)
  }
  return fields
}

/** The field kinds a function body's returns agree on, or `null` when any return is no literal. */
function readReturns(code: string): ReadonlyMap<string, ReturnedKind> | null {
  let program: Node
  try {
    const file = parse(toCodeFile(code, 'javascript'), {
      sourceType: 'unambiguous',
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      errorRecovery: true,
    })
    if (file.errors && file.errors.length > 0) return null
    program = file.program
  } catch {
    return null
  }
  const returns: Array<Node | null | undefined> = []
  walk(program, false, (node) => {
    if (node.type === 'ReturnStatement') returns.push(node.argument)
  })
  if (returns.length === 0) return null
  const inference = new Inference(collectBindings(program))
  let agreed: Map<string, JsKind | undefined> | null = null
  for (const argument of returns) {
    if (argument?.type !== 'ObjectExpression') return null
    const fields = returnedFields(argument, inference)
    if (agreed === null) {
      agreed = fields
      continue
    }
    for (const [key, kind] of agreed) {
      agreed.set(key, fields.has(key) ? merge(kind, fields.get(key)) : undefined)
    }
  }
  const kinds = new Map<string, ReturnedKind>()
  for (const [key, kind] of agreed ?? []) {
    if (kind !== undefined) kinds.set(key, kind === 'string' ? 'string' : 'typed')
  }
  return kinds
}

/**
 * The kind of `result.<field>` of a JavaScript Function block, from the object literal its code
 * returns; `undefined` for any other block, path or language, or when the code does not say.
 */
function functionResultKind(
  block: CanonicalBlock,
  path: readonly string[]
): ReturnedKind | undefined {
  if (block.type !== FUNCTION_TYPE || path.length !== 2 || path[0] !== 'result') return undefined
  let fields = cache.get(block)
  if (fields === undefined) {
    const code = getOwn(block.params, 'code')
    const language = getOwn(block.params, 'language')
    const javascript =
      language === undefined ||
      (language.kind === 'value' && (language.value === 'javascript' || language.value === ''))
    fields =
      javascript && code?.kind === 'value' && typeof code.value === 'string'
        ? readReturns(code.value)
        : null
    cache.set(block, fields)
  }
  return fields?.get(path[1])
}

/**
 * What a stored reference (`<score.result.total>`) holds when it names a field a Function block's
 * code returns as a literal: see {@link functionResultKind}. `block` finds a compiled block by key.
 */
export function referencedResultKind(
  token: string,
  block: (key: BlockKey) => CanonicalBlock | undefined
): ReturnedKind | undefined {
  if (!token.startsWith('<') || !token.endsWith('>')) return undefined
  const path = parseStoredPath(token.slice(1, -1))
  if (!path) return undefined
  const names = path.map((segment) => (segment.kind === 'name' ? segment.name : null))
  const [head, ...rest] = names
  if (head === null || head === undefined || rest.some((name) => name === null)) return undefined
  const target = block(head)
  return target ? functionResultKind(target, rest as string[]) : undefined
}
