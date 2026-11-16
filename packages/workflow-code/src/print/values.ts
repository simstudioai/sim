/**
 * Param values as source expressions (s2 §2 mapping table, D5–D7). Strings become quoted
 * literals, untagged templates, or tagged `t`/`js`/`py`/`sh`/`json`/`md` templates by field kind;
 * resource nodes become call forms; a value outside its field's type prints as `raw(v)`. Sugared
 * forms are chosen only when they compile back to the same stored value.
 */

import type { CatalogSubBlock } from '../catalog/types'
import type { BlockKey, Json, SimNode, Value } from '../model'
import { type Doc, literalText } from './doc'
import type { RefPrinter } from './refs'
import { escapeTemplateText, printKey, printNumber, quoteString } from './strings'
import { arrayExpr, callExpr, type Expr, objectExpr, type Property } from './syntax'

/** The template tag a string field prints with; `t` prints untagged when it holds no refs. */
export type Tag = 't' | 'js' | 'py' | 'sh' | 'json' | 'md'

export interface FieldContext {
  tag: Tag
  /** The block whose param is printed, for scope; `null` at workflow level. */
  from: BlockKey | null
  /** Whole-string refs print as templates instead of bare refs (variables-input values). */
  templateWholeRefs?: boolean
  subBlock?: CatalogSubBlock
}

/**
 * Resource kinds with a dedicated call form (s2 D6). A kind without one prints as
 * `raw(<the CWM node>)`, which compiles back to the same node.
 */
const RESOURCE_CALLS: Partial<Record<string, string>> = {
  credential: 'binding',
  table: 'table',
  'knowledge-base': 'kb',
  workflow: 'workflow',
  skill: 'skill',
  'custom-tool': 'customTool',
  'mcp-server': 'mcp',
  sandbox: 'sandbox',
  file: 'upload',
  'file-folder': 'folder',
}

export interface PrintedValue extends Expr {
  /**
   * True when the value printed as a selector call (`table('x')`, `picked('C1')`, ...) or a
   * non-empty array of them: the form that stores into the basic member of a pair.
   */
  selector?: boolean
}

function isSimNode(value: object): value is SimNode {
  const tag = (value as { $sim?: unknown }).$sim
  return (
    tag === 'var' ||
    tag === 'resource' ||
    tag === 'unresolved' ||
    tag === 'csv' ||
    tag === 'literal'
  )
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

  /** A param value, honoring the field's value kind (selectors, static options). */
  field(value: Value, context: FieldContext): PrintedValue {
    const subBlock = context.subBlock
    const kind = subBlock?.valueKind
    if (kind === 'picked' && isPlainSelectorValue(value)) {
      return { ...this.call('picked', [this.json(value as Json)]), selector: true }
    }
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
    return this.value(value, context)
  }

  value(value: Value, context: FieldContext): PrintedValue {
    if (value === null) return { doc: 'null', shape: 'literal' }
    if (typeof value === 'boolean') return { doc: String(value), shape: 'literal' }
    if (typeof value === 'number')
      return { doc: printNumber(value), shape: 'number', numeric: true }
    if (typeof value === 'string') return this.text(value, context)
    if (Array.isArray(value)) {
      const items = value.map((item) => this.value(item, { ...context, tag: nestedTag(context) }))
      const selector = items.length > 0 && items.every((item) => item.selector === true)
      return { ...arrayExpr(items), selector }
    }
    if (isSimNode(value)) return this.simNode(value)
    const properties: Property[] = Object.entries(value).map(([key, item]) => ({
      key: printKey(key),
      value: this.value(item, { ...context, tag: nestedTag(context) }),
    }))
    return objectExpr(properties)
  }

  /** Plain JSON with no ref or SimNode interpretation, as `literal()` and `raw()` take it. */
  json(value: Json): Expr {
    if (value === null) return { doc: 'null', shape: 'literal' }
    if (typeof value === 'boolean') return { doc: String(value), shape: 'literal' }
    if (typeof value === 'number')
      return { doc: printNumber(value), shape: 'number', numeric: true }
    if (typeof value === 'string') return this.string(value)
    if (Array.isArray(value)) return arrayExpr(value.map((item) => this.json(item)))
    return objectExpr(
      Object.entries(value).map(([key, item]) => ({ key: printKey(key), value: this.json(item) }))
    )
  }

  /** A string with no ref interpretation: quoted, or an untagged template when multi-line. */
  string(text: string): Expr {
    if (!text.includes('\n')) return { doc: quoteString(text), shape: 'string' }
    return { doc: ['`', literalText(escapeTemplateText(text)), '`'], shape: 'template' }
  }

  private simNode(node: SimNode): PrintedValue {
    if (node.$sim === 'var') {
      this.useVars()
      return { doc: `vars${memberOf(node.key)}`, shape: 'member' }
    }
    if (node.$sim === 'resource') {
      const callee = RESOURCE_CALLS[node.kind]
      if (callee) return { ...this.call(callee, [this.string(node.key)]), selector: true }
    }
    return this.call('raw', [this.json(node as unknown as Json)])
  }

  private text(text: string, context: FieldContext): PrintedValue {
    const parts = this.refs.parts(text, context.from)
    const hasRef = parts.some((part) => part.kind === 'ref')
    const [only] = parts
    if (
      parts.length === 1 &&
      only?.kind === 'ref' &&
      context.tag === 't' &&
      context.templateWholeRefs !== true
    ) {
      return { doc: only.expr, shape: /[.[]/.test(only.expr) ? 'member' : 'identifier' }
    }
    if (context.tag === 'json' && !hasRef) {
      const sugar = jsonSugar(text)
      if (sugar !== undefined) return this.json(sugar)
    }
    const tagged = context.tag !== 't' || hasRef
    if (!tagged) return this.string(text)
    const tag = context.tag
    this.use(tag)
    const body: Doc[] = parts.map((part) =>
      part.kind === 'text' ? literalText(escapeTemplateText(part.text)) : ['${', part.expr, '}']
    )
    return { doc: [tag, '`', body, '`'], shape: 'template' }
  }
}

function memberOf(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `.${key}` : `[${quoteString(key)}]`
}

function nestedTag(context: FieldContext): Tag {
  return context.tag === 'json' ? 't' : context.tag === 'md' ? 't' : context.tag
}

/** A stored selector value with no reference text: a non-empty id string. */
function isPlainSelectorValue(value: Value): boolean {
  if (typeof value === 'string') return value.length > 0 && !/[<>{}]/.test(value)
  return false
}

/**
 * A JSON code body that is exactly `JSON.stringify(parsed, null, 2)` of an object or array prints
 * as that literal (s2 D7); anything else stays `json```.
 */
function jsonSugar(text: string): Json | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (parsed === null || typeof parsed !== 'object') return undefined
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
