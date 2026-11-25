/**
 * What a Function block's `result` holds, read from the JavaScript code: the whole value
 * (`return new Date().toISOString()` is text, `return [1, 2]` is not), and the fields of the object
 * literal it returns (`return { total: subtotal + tax, tier: 'gold' }`), so a bare reference to
 * either in a JSON field is typed when the code says whether it is text.
 *
 * The reading is deliberately narrow. The whole value counts only when every `return` outside a
 * nested function yields an expression of one kind and the code ends in a `return` or `throw`
 * (falling off the end returns nothing). A field counts only when every `return` is an object
 * literal and each sets it to an expression whose kind is certain (a literal, arithmetic, a
 * comparison, `String(…)`, the `.length` of a string or an array, a local variable never
 * reassigned to another kind, …). Anything else stays unknown, and the reference keeps its
 * warning: a wrong "typed" would store a string bare, where text that reads as JSON stops being text.
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
/** Methods that return their receiver's kind: a string's `slice` is a string, an array's an array. */
const SAME_KIND_METHODS: ReadonlySet<string> = new Set(['slice', 'concat'])
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

/** What a Function's code returns: the whole value's kind, and the kinds of an object's fields. */
interface ReturnedKinds {
  /** The kind of `result` itself, when every `return` agrees on one and none can be skipped. */
  whole: ReturnedKind | undefined
  /** The fields every `return` sets, when each returns an object literal; empty otherwise. */
  fields: ReadonlyMap<string, ReturnedKind>
}

/** Each function block's returned kinds, read once per compiled block object. */
const cache = new WeakMap<CanonicalBlock, ReturnedKinds | null>()

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
    } else if (
      node.type === 'ImportSpecifier' ||
      node.type === 'ImportDefaultSpecifier' ||
      node.type === 'ImportNamespaceSpecifier'
    ) {
      declare(node.local.name, null)
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
      if (callee.name === 'String') return this.isBuiltin(callee.name) ? 'string' : undefined
      if (!this.isBuiltin(callee.name)) return undefined
      if (NUMBER_FUNCTIONS.has(callee.name)) return 'number'
      if (BOOLEAN_FUNCTIONS.has(callee.name)) return 'boolean'
      return undefined
    }
    const method = memberName(callee)
    if (method === null || !('object' in callee)) return undefined
    if (callee.object.type === 'Identifier') {
      if (callee.object.name === 'Math') return this.isBuiltin('Math') ? 'number' : undefined
      const known = STATIC_KINDS[`${callee.object.name}.${method}`]
      if (known) return this.isBuiltin(callee.object.name) ? known : undefined
    }
    if (STRING_METHODS.has(method))
      return this.producesString(method, callee.object) ? 'string' : undefined
    if (SAME_KIND_METHODS.has(method)) {
      if (this.kind(callee.object) === 'string') return 'string'
      return this.isArray(callee.object, true) ? 'typed' : undefined
    }
    if (BOOLEAN_METHODS.has(method)) return 'boolean'
    if (NUMBER_METHODS.has(method)) return 'number'
    if (ARRAY_METHODS.has(method)) return 'typed'
    return undefined
  }

  /** Whether a global is the built-in: no local declaration or assignment shadows it. */
  private isBuiltin(name: string): boolean {
    return !this.bindings.initial.has(name) && !this.bindings.writes.has(name)
  }

  /**
   * Whether `receiver.method()` certainly yields text. A method name alone proves nothing (an
   * object can define its own `toString`), so the receiver's kind must: a string for the string
   * methods, a number for `toFixed`, an array for `join`, a built-in `Date` for `toISOString`.
   */
  private producesString(method: string, receiver: Node): boolean {
    const kind = this.kind(receiver)
    if (method === 'toString') {
      return kind === 'string' || kind === 'number' || kind === 'boolean' || this.isDate(receiver)
    }
    if (method === 'toFixed' || method === 'toPrecision') return kind === 'number'
    if (method === 'join') return this.isArray(receiver, true)
    if (method === 'toISOString') return this.isDate(receiver)
    if (method === 'toLocaleString') {
      return kind === 'number' || kind === 'string' || kind === 'boolean' || this.isDate(receiver)
    }
    return kind === 'string'
  }

  private isDate(node: Node): boolean {
    return (
      node.type === 'NewExpression' &&
      node.callee.type === 'Identifier' &&
      node.callee.name === 'Date' &&
      this.isBuiltin('Date')
    )
  }

  /**
   * Whether `node` is certainly an array: a literal, an array method's result, `Object.keys`
   * (`values`, `entries`), or a local variable set to one and never reassigned. Any other object
   * can hold anything under `length`. `strict` accepts only what the code proves: a call named
   * like an array method (`map`) may be any object's own, so it proves nothing there.
   */
  private isArray(node: Node, strict = false): boolean {
    if (node.type === 'ArrayExpression') return true
    if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
      const method = memberName(node.callee)
      if (method === null || !('object' in node.callee)) return false
      if (node.callee.object.type === 'Identifier' && node.callee.object.name === 'Object') {
        return (
          this.isBuiltin('Object') &&
          (method === 'keys' || method === 'values' || method === 'entries')
        )
      }
      if (!ARRAY_METHODS.has(method)) return false
      if (!strict) return true
      return method === 'split'
        ? this.kind(node.callee.object) === 'string'
        : this.isArray(node.callee.object, true)
    }
    if (node.type !== 'Identifier') return false
    const init = this.bindings.initial.get(node.name)
    if (!init || this.bindings.writes.has(node.name) || this.resolving.has(node.name)) return false
    this.resolving.add(node.name)
    try {
      return this.isArray(init, strict)
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

/**
 * The kind of the whole returned value: what every `return` yields, when they agree and the code
 * cannot finish without one (it ends in a `return` or `throw`), since falling off the end returns
 * nothing.
 */
function wholeKind(
  program: Node,
  returns: ReadonlyArray<Node | null | undefined>,
  inference: Inference
): ReturnedKind | undefined {
  const last = program.type === 'Program' ? program.body.at(-1) : undefined
  if (last?.type !== 'ReturnStatement' && last?.type !== 'ThrowStatement') return undefined
  let agreed: JsKind | undefined
  for (const [index, argument] of returns.entries()) {
    const kind = inference.kind(argument)
    agreed = index === 0 ? kind : merge(agreed, kind)
    if (agreed === undefined) return undefined
  }
  return agreed === undefined ? undefined : agreed === 'string' ? 'string' : 'typed'
}

/** The field kinds a function body's returns agree on, or none when any return is no literal. */
function readReturns(code: string): ReturnedKinds | null {
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
  const whole = wholeKind(program, returns, inference)
  const objects = returns.filter((argument) => argument?.type === 'ObjectExpression')
  const kinds = new Map<string, ReturnedKind>()
  if (objects.length !== returns.length) return { whole, fields: kinds }
  let agreed: Map<string, JsKind | undefined> | null = null
  for (const argument of objects) {
    if (argument?.type !== 'ObjectExpression') continue
    const fields = returnedFields(argument, inference)
    if (agreed === null) {
      agreed = fields
      continue
    }
    for (const [key, kind] of agreed) {
      agreed.set(key, fields.has(key) ? merge(kind, fields.get(key)) : undefined)
    }
  }
  for (const [key, kind] of agreed ?? []) {
    if (kind !== undefined) kinds.set(key, kind === 'string' ? 'string' : 'typed')
  }
  return { whole, fields: kinds }
}

/**
 * The kind of a JavaScript Function block's `result` (path `['result']`), from what every
 * `return` yields, or of `result.<field>`, from the object literal its code returns; `undefined`
 * for any other block, path or language, or when the code does not say.
 */
function functionResultKind(
  block: CanonicalBlock,
  path: readonly string[]
): ReturnedKind | undefined {
  if (block.type !== FUNCTION_TYPE || path.length < 1 || path.length > 2 || path[0] !== 'result') {
    return undefined
  }
  let kinds = cache.get(block)
  if (kinds === undefined) {
    const code = getOwn(block.params, 'code')
    const language = getOwn(block.params, 'language')
    const javascript =
      language === undefined ||
      (language.kind === 'value' && (language.value === 'javascript' || language.value === ''))
    kinds =
      javascript && code?.kind === 'value' && typeof code.value === 'string'
        ? readReturns(code.value)
        : null
    cache.set(block, kinds)
  }
  return path.length === 1 ? kinds?.whole : kinds?.fields.get(path[1] ?? '')
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
