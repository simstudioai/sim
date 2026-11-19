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
import { blockOutputSchemas } from './catalog/activity'
import type { BlockCatalog, CatalogOutput } from './catalog/types'
import { catalogBlock } from './catalog/view'
import { parseStoredPath, type RefSegment } from './code-files/ref-path'
import {
  type BlockKey,
  type CanonicalBlock,
  type CanonicalParam,
  type CanonicalVariable,
  isSimNode,
  type Value,
} from './model'
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
  if (source === 'inputFormat') {
    const value = stored?.kind === 'value' ? stored.value : undefined
    if (!Array.isArray(value)) return undefined
    for (const item of value) {
      if (isRecordLike(item) && item.name === name) {
        return typeof item.type === 'string' ? item.type : undefined
      }
    }
    return undefined
  }
  if (source === 'responseFormat') return responseFormatFieldTypes(stored)?.get(name)
  return undefined
}

/**
 * A response format's fields by name, each with its type when the runtime's is a string; `null`
 * when the format cannot be read statically.
 */
type ResponseFormatFieldTypes = ReadonlyMap<string, string | undefined> | null

const NO_FIELDS: ResponseFormatFieldTypes = new Map()

/** Per stored param object, the text it held when read and that text's fields. */
const fieldTypesByParam = new WeakMap<
  CanonicalParam,
  { text: string; fields: ResponseFormatFieldTypes }
>()

/**
 * The top-level fields an agent `responseFormat` param declares with their types, read as the
 * runtime reads them (`extractFieldsFromSchema`, apps/sim/lib/core/utils/response-format.ts): a
 * legacy `fields` list with each entry's own type, else a JSON schema's `properties` (under
 * `schema` or at the root), where a property with no `type` is a `'string'` and an array of types
 * is `'array'` when it lists one, else its first. A type the runtime would not read as a string
 * maps to `undefined`. Empty when the param is absent or empty; `null` when it cannot be read
 * statically (not JSON, or JSON holding reference tokens). Memoized per param, since print and
 * compile ask once per reference.
 */
function responseFormatFieldTypes(param: CanonicalParam | undefined): ResponseFormatFieldTypes {
  const value = param?.kind === 'value' ? param.value : undefined
  if (value === undefined || value === null || value === '') return NO_FIELDS
  if (typeof value !== 'string' || !param) return null
  const cached = fieldTypesByParam.get(param)
  if (cached?.text === value) return cached.fields
  const fields = readResponseFormatFields(value)
  fieldTypesByParam.set(param, { text: value, fields })
  return fields
}

function readResponseFormatFields(text: string): ResponseFormatFieldTypes {
  const parsed = parseJsonContainer(text)
  if (!parsed || Array.isArray(parsed)) return null
  const fields = new Map<string, string | undefined>()
  if (Array.isArray(parsed.fields)) {
    for (const field of parsed.fields) {
      if (!isRecordLike(field) || typeof field.name !== 'string') continue
      fields.set(field.name, typeof field.type === 'string' ? field.type : undefined)
    }
    return fields
  }
  const schema = parsed.schema || parsed
  const properties = isRecordLike(schema) ? schema.properties : undefined
  if (typeof properties !== 'object' || properties === null) return fields
  for (const [name, property] of Object.entries(properties)) {
    fields.set(name, propertyType(property))
  }
  return fields
}

/** One schema property's type as `extractFieldsFromSchema` reads it, when that is a string. */
function propertyType(property: unknown): string | undefined {
  if (Array.isArray(property)) {
    const type: unknown = property.includes('array') ? 'array' : property[0] || 'string'
    return typeof type === 'string' ? type : undefined
  }
  if (property === null || property === undefined) return undefined
  const declared = isRecordLike(property) ? property.type : undefined
  const type: unknown = declared || 'string'
  return typeof type === 'string' ? type : undefined
}

/**
 * The top-level field names an agent `responseFormat` param declares ({@link
 * responseFormatFieldTypes}): `[]` when it is absent or empty, `null` when it cannot be read
 * statically, so nothing can be said about its fields.
 */
export function responseFormatFields(param: CanonicalParam | undefined): string[] | null {
  const fields = responseFormatFieldTypes(param)
  return fields ? [...fields.keys()] : null
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
  if (!block || segments.length === 0) return 'untyped'
  // A loop or parallel's `results` is the array of every iteration's output.
  if (block.subflow) {
    const [first] = segments
    return segments.length === 1 && first?.kind === 'name' && first.name === 'results'
      ? 'typed'
      : 'untyped'
  }
  const declared = catalogBlock(scope.catalog, block.type)
  if (!declared) return 'untyped'
  const outputs = blockOutputSchemas(scope.catalog, declared, {
    triggerMode: block.triggerMode,
    values: {
      selectedTriggerId: storedValue(block, 'selectedTriggerId'),
      triggerId: storedValue(block, 'triggerId'),
    },
  })
  const found = outputAt(outputs, segments)
  if (found) return found.type === 'string' ? 'string' : 'typed'
  if (declared.dynamicOutputs) {
    const { source, param } = declared.dynamicOutputs
    const field = dynamicFieldName(source, segments)
    // A human form stores its fields as an input format; they surface at the top level and under `submission`.
    const type =
      field === undefined
        ? undefined
        : dynamicFieldType(block, source === 'humanForm' ? 'inputFormat' : source, param, field)
    if (type !== undefined) return type === 'string' ? 'string' : 'typed'
  }
  // `x.error`: the failure message a block outputs after an error edge (`x.onError(y)`).
  const [first] = segments
  if (segments.length === 1 && first?.kind === 'name' && first.name === 'error') return 'string'
  return 'untyped'
}

/** A block's stored value of `id`, when it holds one. */
function storedValue(block: CanonicalBlock, id: string): Value | undefined {
  const param = getOwn(block.params, id)
  return param?.kind === 'value' ? param.value : undefined
}

/**
 * The dynamic field a ref path names: `<key.field>`, or for a human form also
 * `<key.submission.field>`; the runtime copies a submission's fields to the block's top level,
 * and the SDK types both paths (`human()` in core.d.ts).
 */
function dynamicFieldName(source: string, segments: readonly RefSegment[]): string | undefined {
  const [first, second] = segments
  if (segments.length === 1 && first?.kind === 'name') return first.name
  if (source !== 'humanForm') return undefined
  const underSubmission =
    segments.length === 2 && first?.kind === 'name' && first.name === 'submission'
  return underSubmission && second?.kind === 'name' ? second.name : undefined
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

/**
 * A compiled value as a JSON tree leaf, or `undefined` when it holds a canonical node that is not
 * data (a resource, variable, csv or unresolved node has no JSON form). A `literal` node is data
 * and yields its value.
 */
export function valueTree(value: Value): JsonTree | undefined {
  if (value === null || typeof value !== 'object') return value
  if (isSimNode(value)) return value.$sim === 'literal' ? value.value : undefined
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
