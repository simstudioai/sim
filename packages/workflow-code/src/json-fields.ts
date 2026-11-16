/**
 * JSON code fields (a `code` subBlock holding JSON text: an agent's `responseFormat`, table row
 * `data`, a response body) written as object literals with typed references at their leaves.
 *
 * The executor resolves a reference inside such text by splicing the value's text where the token
 * stands (`resolveTemplate` → `formatValueForBlock`): a string goes in raw, any other value as its
 * JSON. So a token keeps its value's type only when it sits bare for a non-string value
 * (`"n": <score.value>` → `"n": 3`) and quoted for a string (`"s": "<ticket.subject>"`). A bare
 * reference in a literal is stored by its output type: quoted when the catalog types it `string`,
 * bare otherwise, and an untyped one bare with `W_JSON_REF_UNTYPED`, since a string there would
 * break the JSON. A string in the literal (`` t`Hi ${x.name}` ``, `'plain'`) is always a JSON
 * string, which is how a value is turned into text on purpose.
 *
 * The printer writes stored text back as a literal only when serializing that literal reproduces
 * the text byte for byte; everything else keeps its text form. Print and compile decide each
 * token's form through the same {@link refValueKind} over the same canonical workflow.
 */

import { isRecordLike } from '@sim/utils/object'
import type { BlockCatalog, CatalogOutput } from './catalog/types'
import { catalogBlock, catalogTrigger } from './catalog/view'
import { parseStoredPath, type RefSegment } from './code-files/ref-path'
import type { BlockKey, CanonicalBlock, CanonicalVariable, Value } from './model'
import { getOwn, parseJsonContainer, setOwn } from './records'

/** A reference at a leaf of a JSON field: the stored token, and whether the text quotes it. */
export class JsonRef {
  constructor(
    readonly token: string,
    readonly quoted: boolean
  ) {}
}

/** JSON whose leaves may be references. */
export type JsonTree =
  | null
  | boolean
  | number
  | string
  | JsonRef
  | JsonTree[]
  | { [key: string]: JsonTree }

/** How a reference's value is typed; only `string` is stored quoted. */
type RefValueKind = 'string' | 'typed' | 'untyped'

/** What {@link refValueKind} reads: the workflow's blocks and variables. */
export interface RefTypeScope {
  catalog: BlockCatalog
  block(key: BlockKey): CanonicalBlock | undefined
  variable(key: string): CanonicalVariable | undefined
}

const STRING_VARIABLE_TYPES: ReadonlySet<string> = new Set(['string', 'plain'])

function outputAt(
  outputs: Record<string, CatalogOutput>,
  segments: RefSegment[]
): CatalogOutput | undefined {
  let level: Record<string, CatalogOutput> | undefined = outputs
  let current: CatalogOutput | undefined
  for (const segment of segments) {
    if (segment.kind === 'index') {
      current = current?.type === 'array' ? current.items : undefined
      level = current?.properties
    } else {
      current = level ? getOwn(level, segment.name) : undefined
      level = current?.properties
    }
    if (!current) return undefined
  }
  return current
}

/** The declared type of `name` in a block's dynamic output source, when it is readable. */
function dynamicFieldType(block: CanonicalBlock, source: string, param: string, name: string) {
  const stored = getOwn(block.params, param)
  const value = stored?.kind === 'value' ? stored.value : undefined
  if (source === 'inputFormat' && Array.isArray(value)) {
    for (const item of value) {
      if (isRecordLike(item) && item.name === name) {
        return typeof item.type === 'string' ? item.type : undefined
      }
    }
    return undefined
  }
  if (source === 'responseFormat' && typeof value === 'string') {
    const parsed = parseJsonContainer(value)
    if (!parsed || Array.isArray(parsed)) return undefined
    const schema =
      typeof parsed.schema === 'object' && parsed.schema !== null ? parsed.schema : parsed
    const properties = (schema as { properties?: unknown }).properties
    if (!properties || typeof properties !== 'object') return undefined
    const field = getOwn(properties as Record<string, unknown>, name)
    const type = field && typeof field === 'object' ? (field as { type?: unknown }).type : undefined
    return typeof type === 'string' ? type : undefined
  }
  return undefined
}

/**
 * What a stored token (`<key.path>`, `<variable.x>`, `{{ENV}}`) resolves to, as far as the catalog
 * and the workflow say: `string`, `typed` (any other declared type), or `untyped` when nothing
 * declares it (a path into untyped JSON, a loop item, an unknown block). An environment variable
 * is a string; a variable goes by its type; a block output by its declared output type, else by
 * the field its dynamic outputs declare.
 */
export function refValueKind(token: string, scope: RefTypeScope): RefValueKind {
  if (token.startsWith('{{')) return 'string'
  const path = parseStoredPath(token.slice(1, -1))
  const head = path?.[0]
  if (!path || head?.kind !== 'name') return 'untyped'
  const segments = path.slice(1)
  if (head.name === 'variable') {
    const first = segments[0]
    const variable =
      segments.length === 1 && first?.kind === 'name' ? scope.variable(first.name) : undefined
    if (!variable) return 'untyped'
    return STRING_VARIABLE_TYPES.has(variable.type) ? 'string' : 'typed'
  }
  const block = scope.block(head.name)
  if (!block || block.subflow || segments.length === 0) return 'untyped'
  const declared = catalogBlock(scope.catalog, block.type)
  if (!declared) return 'untyped'
  const schemas = [declared.outputs]
  if (block.triggerMode) {
    const pinned = getOwn(block.params, 'selectedTriggerId')
    const ids =
      pinned?.kind === 'value' && typeof pinned.value === 'string'
        ? [pinned.value]
        : (declared.triggers?.available ?? [])
    for (const id of ids) {
      const trigger = catalogTrigger(scope.catalog, id)
      if (trigger) schemas.push(trigger.outputs)
    }
  }
  const found = schemas.map((outputs) => outputAt(outputs, segments)).find(Boolean)
  if (found) return found.type === 'string' ? 'string' : 'typed'
  const [first] = segments
  if (declared.dynamicOutputs && segments.length === 1 && first?.kind === 'name') {
    const { source, param } = declared.dynamicOutputs
    const type = dynamicFieldType(block, source, param, first.name)
    if (type !== undefined) return type === 'string' ? 'string' : 'typed'
  }
  return 'untyped'
}

/**
 * The stored text of a JSON field: `JSON.stringify(tree, null, 2)`, with each reference written
 * quoted when `isString` says its value is a string and bare otherwise.
 */
export function jsonFieldText(tree: JsonTree, isString: (token: string) => boolean): string {
  const write = (value: JsonTree, indent: string): string => {
    if (value instanceof JsonRef) return isString(value.token) ? `"${value.token}"` : value.token
    if (value === null || typeof value !== 'object') return JSON.stringify(value)
    const inner = `${indent}  `
    if (Array.isArray(value)) {
      if (value.length === 0) return '[]'
      return `[\n${value.map((item) => inner + write(item, inner)).join(',\n')}\n${indent}]`
    }
    const entries = Object.entries(value)
    if (entries.length === 0) return '{}'
    const members = entries.map(
      ([key, item]) => `${inner}${JSON.stringify(key)}: ${write(item, inner)}`
    )
    return `{\n${members.join(',\n')}\n${indent}}`
  }
  return write(tree, '')
}

/** The single reference a whole JSON string holds (`"<a.b>"`, `"{{X}}"`), if any. */
function wholeToken(text: string): string | null {
  if (/^\{\{[A-Za-z_][A-Za-z0-9_]*\}\}$/.test(text)) return text
  if (!text.startsWith('<') || !text.endsWith('>')) return null
  return parseStoredPath(text.slice(1, -1)) ? text : null
}

/**
 * Parses JSON field text into a tree: JSON, plus bare `<path>` and `{{NAME}}` tokens at value
 * positions, with a string that is exactly one token read as a quoted reference. `undefined` when
 * the text is not an object or array in that grammar.
 */
export function parseJsonField(text: string): JsonTree | undefined {
  let index = 0
  function fail(): never {
    throw new SyntaxError('not a JSON field')
  }
  const space = () => {
    while (index < text.length && /[ \t\n\r]/.test(text[index] ?? '')) index++
  }
  const string = (): string => {
    const start = index
    index++
    while (index < text.length && text[index] !== '"') index += text[index] === '\\' ? 2 : 1
    if (index >= text.length) fail()
    index++
    return JSON.parse(text.slice(start, index)) as string
  }
  const value = (): JsonTree => {
    space()
    const char = text[index]
    if (char === '<' || text.startsWith('{{', index)) {
      const close = char === '<' ? '>' : '}}'
      const end = text.indexOf(close, index)
      if (end === -1) fail()
      const token = wholeToken(text.slice(index, end + close.length))
      if (token === null) fail()
      index = end + close.length
      return new JsonRef(token, false)
    }
    if (char === '{') {
      index++
      const result: { [key: string]: JsonTree } = {}
      space()
      if (text[index] === '}') {
        index++
        return result
      }
      for (;;) {
        space()
        if (text[index] !== '"') fail()
        const key = string()
        space()
        if (text[index] !== ':') fail()
        index++
        if (Object.hasOwn(result, key)) fail()
        setOwn(result, key, value())
        space()
        if (text[index] === ',') {
          index++
          continue
        }
        if (text[index] !== '}') fail()
        index++
        return result
      }
    }
    if (char === '[') {
      index++
      const result: JsonTree[] = []
      space()
      if (text[index] === ']') {
        index++
        return result
      }
      for (;;) {
        result.push(value())
        space()
        if (text[index] === ',') {
          index++
          continue
        }
        if (text[index] !== ']') fail()
        index++
        return result
      }
    }
    if (char === '"') {
      const parsed = string()
      const token = wholeToken(parsed)
      return token === null ? parsed : new JsonRef(token, true)
    }
    const literal =
      /^(?:-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|true|false|null)/.exec(
        text.slice(index)
      )
    if (!literal) fail()
    index += literal[0].length
    return JSON.parse(literal[0]) as JsonTree
  }
  try {
    space()
    if (text[index] !== '{' && text[index] !== '[') return undefined
    const tree = value()
    space()
    return index === text.length ? tree : undefined
  } catch {
    return undefined
  }
}

/** A compiled value as a JSON tree leaf, or `undefined` for a canonical node that is not data. */
export function valueTree(value: Value): JsonTree | undefined {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    const items: JsonTree[] = []
    for (const item of value) {
      const tree = valueTree(item)
      if (tree === undefined) return undefined
      items.push(tree)
    }
    return items
  }
  const result: { [key: string]: JsonTree } = {}
  for (const [key, item] of Object.entries(value)) {
    const tree = valueTree(item as Value)
    if (tree === undefined) return undefined
    setOwn(result, key, tree)
  }
  return result
}
