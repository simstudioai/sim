/**
 * Start and trigger input fields (`input-format`). Each field's id moves to the lock's `items`
 * when its name keys it uniquely, and comes back from there on apply. The record sugar works both
 * directions: a stored field list prints as a record keyed by field name when it compiles back to
 * the same list, and a written record compiles to that list.
 */

import { isRecordLike, omit } from '@sim/utils/object'
import type { CanonContext } from '../canonicalize/context'
import { toValue } from '../canonicalize/values'
import { unsupported } from '../compile/context'
import { isJson, type LockItem } from '../lock'
import type { MaterializeContext } from '../materialize/context'
import type { ParamSite } from '../materialize/params'
import { sharesEvidence, soleRename } from '../materialize/rename'
import { type BlockKey, isPlainRecord, type Value } from '../model'
import { printKey } from '../print/strings'
import { objectExpr, type Property } from '../print/syntax'
import type { FieldContext, PrintedValue, ValuePrinter } from '../print/values'
import { parseStoredList, setOwn } from '../records'
import { encodePlain, liftPlain, type StructuredCodec } from './codec'

const INTEGER_LIKE = /^(0|[1-9][0-9]*)$/
const INPUT_FIELD_KEYS = new Set(['name', 'type', 'value', 'description', 'required'])

/**
 * The `inputFormat` record sugar: `{ subject: 'string' }` for `{ name, type, value: '' }`
 * items, `{ name: { type, value?, description?, required? } }` otherwise. `null` when any item
 * would not compile back to the same list (unknown keys, duplicate or integer-like names).
 */
function inputFormatSugar(
  value: Value
): Array<{ name: string; item: Record<string, Value> }> | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const seen = new Set<string>()
  const items: Array<{ name: string; item: Record<string, Value> }> = []
  for (const entry of value) {
    if (!isPlainRecord(entry)) return null
    const record = entry
    const name = record.name
    if (typeof name !== 'string' || typeof record.type !== 'string') return null
    if (seen.has(name) || INTEGER_LIKE.test(name) || name === '__proto__') return null
    if (Object.keys(record).some((key) => !INPUT_FIELD_KEYS.has(key))) return null
    seen.add(name)
    items.push({ name, item: record })
  }
  return items
}

/**
 * The record keys whose entry also writes a different `name`: the key names the field, so such an
 * entry is refused rather than stored under a name its references would not match.
 */
function renamedInputFields(value: Value): Array<{ key: string; name: Value }> {
  if (!isPlainRecord(value)) return []
  return Object.entries(value).flatMap(([key, entry]) =>
    isPlainRecord(entry) && Object.hasOwn(entry, 'name') && entry.name !== key
      ? [{ key, name: entry.name }]
      : []
  )
}

/**
 * The record keys whose entry names no type: neither a type string nor a record with a string
 * `type`. The SDK types every entry as one of those, so a bare value (`count: 5`) is refused rather
 * than stored as a field with no type.
 */
function untypedInputFields(value: Value): string[] {
  if (!isPlainRecord(value)) return []
  return Object.entries(value).flatMap(([key, entry]) =>
    typeof entry === 'string' || (isPlainRecord(entry) && typeof entry.type === 'string')
      ? []
      : [key]
  )
}

/**
 * The record sugar compiled: `{ name: 'string' }` or `{ name: { type, ... } }` → stored item list.
 * The record key is always the field name; an entry's own `name` never replaces it.
 */
function inputFormatItems(value: Value): Value {
  if (!isPlainRecord(value)) return value
  return Object.entries(value).map(([name, entry]) => {
    if (typeof entry === 'string') return { name, type: entry, value: '' }
    const item: Record<string, Value> = { name }
    if (isPlainRecord(entry)) {
      for (const [key, field] of Object.entries(entry)) {
        if (key !== 'name') setOwn(item, key, field)
      }
    }
    return item
  })
}

/**
 * The names exactly one inputFormat field carries: only such a field's id moves to the lock, since
 * a name shared or missing cannot key it back.
 */
function uniqueFieldNames(list: readonly unknown[]): Set<string> {
  const counts = new Map<string, number>()
  for (const item of list) {
    if (isRecordLike(item) && typeof item.name === 'string') {
      counts.set(item.name, (counts.get(item.name) ?? 0) + 1)
    }
  }
  return new Set([...counts].filter(([, count]) => count === 1).map(([name]) => name))
}

/**
 * The inputFormat fields whose id moves to the lock's `items`, by list index: a string id and a
 * string name that no other field shares. The lock holds one id per name and each id once.
 */
function liftedFieldIds(list: readonly unknown[]): Map<number, LockItem> {
  const names = uniqueFieldNames(list)
  const idCounts = new Map<string, number>()
  for (const item of list) {
    if (isRecordLike(item) && typeof item.id === 'string') {
      idCounts.set(item.id, (idCounts.get(item.id) ?? 0) + 1)
    }
  }
  const lifted = new Map<number, LockItem>()
  list.forEach((item, index) => {
    if (!isRecordLike(item) || Object.hasOwn(item, '$sim')) return
    const { id, name } = item
    if (typeof id !== 'string' || typeof name !== 'string') return
    if (names.has(name) && idCounts.get(id) === 1) lifted.set(index, { name, id })
  })
  return lifted
}

const BLANK_FIELD_KEYS = new Set(['id', 'name', 'type', 'value', 'collapsed'])

/**
 * Whether `list` is only the blank starter field every new Start block is seeded with: no name,
 * the default `string` type and no value, description or required flag. Execution skips a field
 * without a name, so the list carries nothing and canonicalize reads it as empty, as it drops a
 * table's blank starter row; an apply that leaves the fields unchanged keeps the stored list. A
 * blank field beside others is kept, so a list the person shaped prints as stored.
 */
function isUntouchedStarterList(list: readonly unknown[]): boolean {
  if (list.length !== 1) return false
  const [item] = list
  return (
    isRecordLike(item) &&
    item.name === '' &&
    item.type === 'string' &&
    (item.value === undefined || item.value === '') &&
    Object.keys(item).every((key) => BLANK_FIELD_KEYS.has(key))
  )
}

/**
 * The editor's `collapsed` flag is dropped, an untouched starter list
 * ({@link isUntouchedStarterList}) reads as empty, and the id of each field
 * {@link liftedFieldIds} picks moves to the lock's `items`. Any other field keeps its id inline,
 * so nothing is lost.
 */
function liftInputFormat(
  stored: unknown[],
  context: CanonContext
): { value: Value; items: LockItem[] } {
  const list = isUntouchedStarterList(stored) ? [] : stored
  const lifted = liftedFieldIds(list)
  const value = list.map((item, index) => {
    if (!isRecordLike(item) || Object.hasOwn(item, '$sim')) return toValue(item, context)
    const rest = omit(item, ['collapsed'])
    return toValue(lifted.has(index) ? omit(rest, ['id']) : rest, context)
  })
  return { value, items: [...lifted.values()] }
}

/**
 * Puts inputFormat field ids back: canonicalize moved the id of every field whose name and id are
 * both unique to the lock, so each such field takes the lock's id for its name, then prev's, else a
 * new one. When exactly one field's name is new and exactly one known id's name is gone, and prev
 * stored that id with the same type, the field is a rename and keeps the id. Fields that kept their
 * id inline keep it. Every field with an id takes the editor's `collapsed` flag from the prev field
 * with that id.
 */
function restoreInputFormatIds(list: unknown[], site: ParamSite, context: MaterializeContext) {
  const unique = uniqueFieldNames(list)
  const prevById = new Map<string, Record<string, unknown>>()
  for (const item of parseStoredList(site.prevRaw) ?? []) {
    if (isRecordLike(item) && typeof item.id === 'string') prevById.set(item.id, item)
  }
  const withPrevCollapsed = (id: string, item: Record<string, unknown>) => {
    const prevItem = prevById.get(id)
    if (prevItem?.collapsed === undefined) return item
    return { ...item, collapsed: prevItem.collapsed }
  }
  const used = new Set<string>()
  const known = list.map((item) => {
    if (!isRecordLike(item) || item.id !== undefined) return undefined
    if (typeof item.name !== 'string' || !unique.has(item.name)) return undefined
    const name = item.name
    const entry = site.itemIds.find(
      (candidate) => candidate.name === name && !used.has(candidate.id)
    )
    if (entry) used.add(entry.id)
    return entry?.id
  })
  const renamed = renamedFieldId(list, known, unique, site.itemIds, prevById, used)
  return list.map((item, index) => {
    if (!isRecordLike(item)) return item
    if (item.id !== undefined) {
      return typeof item.id === 'string' ? withPrevCollapsed(item.id, item) : item
    }
    if (typeof item.name !== 'string' || !unique.has(item.name)) return item
    const id = known[index] ?? (renamed?.index === index ? renamed.id : context.hooks.newId())
    used.add(id)
    return withPrevCollapsed(id, { id, ...item })
  })
}

/**
 * The one field a lone rename left without a known id, with the id prev stored under the former
 * name, when prev's field shares its type and its default value or description (see
 * {@link soleRename}).
 */
function renamedFieldId(
  list: readonly unknown[],
  known: ReadonlyArray<string | undefined>,
  unique: ReadonlySet<string>,
  itemIds: readonly LockItem[],
  prevById: ReadonlyMap<string, Record<string, unknown>>,
  used: ReadonlySet<string>
): { index: number; id: string } | null {
  const names = new Set(list.flatMap((item) => (isRecordLike(item) ? [item.name] : [])))
  const renamed = soleRename(
    list.flatMap((item, index) =>
      isRecordLike(item) &&
      item.id === undefined &&
      typeof item.name === 'string' &&
      unique.has(item.name) &&
      known[index] === undefined
        ? [index]
        : []
    ),
    [
      ...new Set(
        itemIds
          .filter((entry) => !names.has(entry.name) && !used.has(entry.id))
          .map((entry) => entry.id)
      ),
    ].map((id) => [id, id] as const),
    (index, id) => {
      const field = list[index]
      const former = prevById.get(id)
      return (
        isRecordLike(field) &&
        former !== undefined &&
        former.type === field.type &&
        sharesEvidence<Record<string, unknown>>(former, field, ['value', 'description'])
      )
    }
  )
  return renamed && { index: renamed.item, id: renamed.id }
}

/** The record sugar as source: `name: 'type'`, or `name: { type, value?, description?, required? }`. */
function printRecord(
  values: ValuePrinter,
  block: BlockKey,
  items: Array<{ name: string; item: Record<string, Value> }>
): PrintedValue {
  const nested: FieldContext = { tag: 't', from: block }
  return objectExpr(
    items.map(({ name, item }) => {
      const keys = Object.keys(item)
      const short =
        keys.length === 3 && 'value' in item && item.value === '' && typeof item.type === 'string'
      if (short && typeof item.type === 'string') {
        return { key: printKey(name), value: values.string(item.type) }
      }
      const properties: Property[] = []
      for (const field of ['type', 'value', 'description', 'required']) {
        const fieldValue = item[field]
        if (fieldValue === undefined) continue
        properties.push({ key: field, value: values.value(fieldValue, nested) })
      }
      return { key: printKey(name), value: objectExpr(properties) }
    })
  )
}

export const INPUT_FORMAT_CODEC: StructuredCodec = {
  lift(decoded, { context }) {
    if (!Array.isArray(decoded)) return liftPlain()
    const lifted = liftInputFormat(decoded, context)
    return {
      param: { kind: 'value', value: lifted.value },
      ...(lifted.items.length > 0 && { items: lifted.items }),
    }
  },
  varNodes: false,
  compileLiteral(value, { ctx, node, blockKey }) {
    for (const renamed of renamedInputFields(value)) {
      unsupported(
        ctx,
        node,
        `The ${renamed.key} field also writes name ${JSON.stringify(renamed.name)}; the key names the field.`,
        `Rename the key, or remove name from ${renamed.key}.`,
        blockKey
      )
    }
    for (const key of untypedInputFields(value)) {
      unsupported(
        ctx,
        node,
        `The ${key} field names no type.`,
        `Write ${key}: 'string', or ${key}: { type: 'number', value: 5 }.`,
        blockKey
      )
    }
    return inputFormatItems(value)
  },
  print(value, { values, block }) {
    if (!Array.isArray(value)) return null
    const sugar = inputFormatSugar(value)
    if (sugar) return printRecord(values, block, sugar)
    // The record form is the only one the SDK types: an empty list is `{}`, and a list the
    // record cannot carry (an integer-like or repeated name, an unknown key) is kept verbatim.
    if (value.length === 0) return objectExpr([])
    if (isJson(value)) return values.call('raw', [values.json(value)])
    return null
  },
  encode(value, site, context) {
    const json = encodePlain(value, site, context)
    return Array.isArray(json) ? restoreInputFormatIds(json, site, context) : json
  },
  lockItems(stored) {
    const list = parseStoredList(stored) ?? []
    return isUntouchedStarterList(list) ? [] : [...liftedFieldIds(list).values()]
  },
}
