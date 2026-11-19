/**
 * Param values as source expressions (D5–D7). Strings become quoted
 * literals, untagged templates, or tagged `t`/`js`/`py`/`sh`/`json`/`md` templates by field kind;
 * resource nodes become call forms; a value outside its field's type prints as `raw(v)`. Sugared
 * forms are chosen only when they compile back to the same stored value.
 */

import type { CatalogSubBlock } from '../catalog/types'
import { type BlockKey, isSimNode, type Json, type SimNode, type Value } from '../model'
import { getOwn, parseJsonContainer } from '../records'
import { SDK_RESOURCE_CALLS, type TemplateTag } from '../sdk'
import { type Doc, literalText } from './doc'
import type { RefPrinter } from './refs'
import { escapeTemplateText, printKey, printMember, printNumber, quoteString } from './strings'
import { arrayExpr, callExpr, type Expr, objectExpr, type Property, pathDepth } from './syntax'

export interface FieldContext {
  /** The template tag the field prints with; `t` prints untagged when it holds no refs. */
  tag: TemplateTag
  /** The block whose param is printed, for scope; `null` at workflow level. */
  from: BlockKey | null
  /**
   * A variables-input field (`structured: 'variables'`), where a bare `vars.x` compiles to the
   * variable node (compile/SYNTAX.md, `vars.x`). There a var node prints as bare `vars.x` and a
   * whole-string `<variable.x>` prints as a `t` template; elsewhere a var node prints as `raw()`
   * and a whole-string ref prints bare.
   */
  variablesField?: boolean
  subBlock?: CatalogSubBlock
  /**
   * The free-text twin of a credential picker (`isCredentialIdTwin`), whose type takes no literal
   * text: a stored literal id prints as `raw('…')`, which compiles back to the same text.
   */
  credentialId?: boolean
}

export interface PrintedValue extends Expr {
  /**
   * True when the value printed as a selector call (`table('x')`, `file('a.pdf')`, ...) or a
   * non-empty array of them: the form that stores into the basic member of a pair.
   */
  selector?: boolean
}

/** Prints values, recording SDK imports and reference diagnostics as it goes. */
export class ValuePrinter {
  constructor(
    private readonly refs: RefPrinter,
    private readonly use: (name: string) => void,
    private readonly useVars: () => void
  ) {}

  call(callee: string, args: Expr[]): Expr {
    this.use(callee.split('.')[0] ?? callee)
    return callExpr(callee, args)
  }

  /** `root(rootArgs).method(args)`, a method of an SDK value: `mcp('docs').tool('search')`. */
  methodCall(root: string, rootArgs: Expr[], method: string, args: Expr[]): Expr {
    this.use(root)
    const rootCall = callExpr(root, rootArgs)
    return callExpr(
      { doc: [rootCall.doc, `.${method}`], shape: 'member', depth: 1 + rootCall.depth },
      args
    )
  }

  /** A param value, honoring the field's value kind (selectors, static options). */
  field(value: Value, context: FieldContext): PrintedValue {
    const subBlock = context.subBlock
    if (
      typeof value === 'string' &&
      value !== '' &&
      !/[<{]/.test(value) &&
      Array.isArray(subBlock?.options) &&
      subBlock.type === 'dropdown' &&
      !subBlock.options.some((option) => option.id === value)
    ) {
      return this.call('raw', [this.string(value)])
    }
    if (context.credentialId === true && typeof value === 'string' && value !== '') {
      return this.text(value, context, true)
    }
    return this.value(value, context)
  }

  value(value: Value, context: FieldContext): PrintedValue {
    if (value === null) return { doc: 'null', shape: 'literal', depth: 1 }
    if (typeof value === 'boolean') return { doc: String(value), shape: 'literal', depth: 1 }
    if (typeof value === 'number') return numberExpr(value)
    if (typeof value === 'string') return this.text(value, context)
    if (Array.isArray(value)) {
      const items = value.map((item) => this.value(item, { ...context, tag: nestedTag(context) }))
      const selector = items.length > 0 && items.every((item) => item.selector === true)
      return { ...arrayExpr(items), selector }
    }
    if (isSimNode(value)) return this.simNode(value, context)
    const properties: Property[] = Object.entries(value).map(([key, item]) => ({
      key: printKey(key),
      value: this.value(item, { ...context, tag: nestedTag(context) }),
    }))
    return objectExpr(properties)
  }

  /** Plain JSON with no ref or SimNode interpretation, as `literal()` and `raw()` take it. */
  json(value: Json): Expr {
    if (value === null) return { doc: 'null', shape: 'literal', depth: 1 }
    if (typeof value === 'boolean') return { doc: String(value), shape: 'literal', depth: 1 }
    if (typeof value === 'number') return numberExpr(value)
    if (typeof value === 'string') return this.string(value)
    if (Array.isArray(value)) return arrayExpr(value.map((item) => this.json(item)))
    return objectExpr(
      Object.entries(value).map(([key, item]) => ({ key: printKey(key), value: this.json(item) }))
    )
  }

  /** A string with no ref interpretation: quoted, or an untagged template when multi-line. */
  string(text: string): Expr {
    if (!text.includes('\n')) return { doc: quoteString(text), shape: 'string', depth: 1 }
    // TemplateLiteral, then TemplateElement.
    return { doc: ['`', literalText(escapeTemplateText(text)), '`'], shape: 'template', depth: 2 }
  }

  private simNode(node: SimNode, context: FieldContext): PrintedValue {
    if (node.$sim === 'var' && context.variablesField === true) {
      this.useVars()
      const doc = `vars${printMember(node.key)}`
      return { doc, shape: 'member', depth: pathDepth(doc) }
    }
    if (node.$sim === 'resource') {
      const callee = getOwn<string>(SDK_RESOURCE_CALLS, node.kind)
      if (callee) return { ...this.call(callee, [this.string(node.key)]), selector: true }
    }
    return this.call('raw', [this.json(simNodeJson(node))])
  }

  /** Text with its references; plain text is a string, or `raw()` of one when `rawPlain`. */
  private text(text: string, context: FieldContext, rawPlain = false): PrintedValue {
    const parts = this.refs.parts(text, context.from)
    const hasRef = parts.some((part) => part.kind === 'ref')
    const [only] = parts
    if (
      parts.length === 1 &&
      only?.kind === 'ref' &&
      context.tag === 't' &&
      context.variablesField !== true
    ) {
      return refExpr(only.expr)
    }
    if (context.tag === 'json' && !hasRef) {
      const sugar = jsonSugar(text)
      if (sugar !== undefined) return this.json(sugar)
    }
    const tagged = context.tag !== 't' || hasRef
    if (!tagged) return rawPlain ? this.call('raw', [this.string(text)]) : this.string(text)
    const tag = context.tag
    this.use(tag)
    const body: Doc[] = parts.map((part) =>
      part.kind === 'text' ? literalText(escapeTemplateText(part.text)) : ['${', part.expr, '}']
    )
    let refDepth = 1
    for (const part of parts) {
      if (part.kind === 'ref') refDepth = Math.max(refDepth, pathDepth(part.expr))
    }
    // TaggedTemplateExpression, then TemplateLiteral, then a TemplateElement or reference.
    return { doc: [tag, '`', body, '`'], shape: 'template', depth: 2 + refDepth }
  }
}

/** A JSON number; a negative one is a unary minus over the literal. */
function numberExpr(value: number): Expr {
  return { doc: printNumber(value), shape: 'number', numeric: true, depth: 2 }
}

/** A reference printed bare: `start.input`, `vars.x`. */
export function refExpr(expr: string): Expr {
  return { doc: expr, shape: /[.[]/.test(expr) ? 'member' : 'identifier', depth: pathDepth(expr) }
}

function nestedTag(context: FieldContext): TemplateTag {
  return context.tag === 'json' ? 't' : context.tag === 'md' ? 't' : context.tag
}

/**
 * A JSON code body that is exactly `JSON.stringify(parsed, null, 2)` of an object or array prints
 * as that literal; anything else stays `json```.
 */
function jsonSugar(text: string): Json | undefined {
  const parsed = parseJsonContainer(text)
  if (parsed === undefined) return undefined
  if (JSON.stringify(parsed, null, 2) !== text) return undefined
  if (containsSimKey(parsed)) return undefined
  return parsed as Json
}

function containsSimKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSimKey)
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).some(([key, item]) => key === '$sim' || containsSimKey(item))
  }
  return false
}

/** A {@link SimNode} as the plain JSON `raw()` takes, fields in the order canonicalize writes. */
function simNodeJson(node: SimNode): Json {
  switch (node.$sim) {
    case 'var':
      return { $sim: node.$sim, key: node.key }
    case 'resource':
      return { $sim: node.$sim, kind: node.kind, key: node.key }
    case 'unresolved':
      return { $sim: node.$sim, kind: node.kind, id: node.id }
    case 'csv':
      return { $sim: node.$sim, items: node.items.map(simNodeJson) }
    case 'literal':
      return { $sim: node.$sim, value: node.value }
  }
}
