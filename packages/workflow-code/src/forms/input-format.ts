/**
 * The `inputFormat` record sugar, both directions: a stored field list prints as a record keyed by
 * field name when it compiles back to the same list, and a written record compiles to that list.
 */

import { isPlainRecord, type Value } from '../model'
import { setOwn } from '../records'

const INTEGER_LIKE = /^(0|[1-9][0-9]*)$/
const INPUT_FIELD_KEYS = new Set(['name', 'type', 'value', 'description', 'required'])

/**
 * The `inputFormat` record sugar: `{ subject: 'string' }` for `{ name, type, value: '' }`
 * items, `{ name: { type, value?, description?, required? } }` otherwise. `null` when any item
 * would not compile back to the same list (unknown keys, duplicate or integer-like names).
 */
export function inputFormatSugar(
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

/** The record sugar compiled: `{ name: 'string' }` or `{ name: { type, ... } }` → stored item list. */
export function inputFormatItems(value: Value): Value {
  if (!isPlainRecord(value)) return value
  return Object.entries(value).map(([name, entry]) => {
    if (typeof entry === 'string') return { name, type: entry, value: '' }
    const item: Record<string, Value> = { name }
    if (isPlainRecord(entry)) {
      for (const [key, field] of Object.entries(entry)) setOwn(item, key, field)
    } else {
      setOwn(item, 'value', entry)
    }
    return item
  })
}
