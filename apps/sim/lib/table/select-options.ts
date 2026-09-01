/**
 * Pure `select`-option helpers, with no database dependency.
 *
 * These live in their own leaf module rather than in `validation.ts` on
 * purpose. `validation.ts` imports `@sim/db`, `drizzle-orm`, and `next/server`,
 * so anything importing it — `select-values.ts`, and transitively
 * `cell-format.ts` and `export-format.ts` — becomes server-only. That taint is
 * the sole reason the tables grid used to hand-roll its own copy of the
 * id-resolution logic client-side, and why a select cell's stored ids could
 * drift from the names the client resolved them to.
 *
 * Keeping the option primitives here lets both sides share one implementation.
 */

import { generateShortId } from '@sim/utils/id'
import type { ColumnDefinition, JsonValue, SelectOption } from '@/lib/table/types'

/** Set of valid option ids for a `select`/`multiselect` column. */
export function optionIds(column: ColumnDefinition): Set<string> {
  return new Set((column.options ?? []).map((o) => o.id))
}

/**
 * Resolves a raw cell value to a declared option id, accepting either the
 * stable id or (tolerant for tool/import writes) the option's display name.
 * Returns null when no option matches.
 *
 * Id wins over name, and an exact name wins over a case-folded one, so an
 * option whose *name* equals another option's *id* can never repoint a cell.
 */
export function resolveSelectOptionId(value: JsonValue, options: SelectOption[]): string | null {
  // The block builder serializes without schema access, so an option NAME that
  // looks numeric or boolean ("123", "true") arrives scalar-coerced. Stringify
  // scalars so the name still resolves; arrays/objects stay unresolvable.
  const text =
    typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : null
  if (text === null) return null
  const byId = options.find((o) => o.id === text)
  if (byId) return byId.id
  const byName =
    options.find((o) => o.name === text) ??
    options.find((o) => o.name.toLowerCase() === text.toLowerCase())
  return byName ? byName.id : null
}

/**
 * Splits a raw value into the parts a multi-select cell should resolve. A cell
 * may arrive as an array (canonical) or as a single comma-delimited string —
 * the shape a multi cell exports, copies, and converts to text as — so both the
 * write-path coercion and the column-conversion compatibility check read it
 * through here rather than each deciding for itself. Option names that
 * themselves contain commas are an accepted ambiguity.
 */
export function splitMultiSelectInput(value: JsonValue): JsonValue[] {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string') return [value]
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
}

/**
 * Resolves a raw value to the canonical stored shape for a select column: an
 * array of option ids when `multiple`, otherwise a single id (or `null`).
 *
 * This is the one place the multi/single split is decided. Unresolvable parts
 * are dropped and duplicates collapse to their first occurrence.
 */
export function resolveSelectCellValue(value: JsonValue, column: ColumnDefinition): JsonValue {
  const options = column.options ?? []
  if (column.multiple) {
    const ids: string[] = []
    for (const entry of splitMultiSelectInput(value)) {
      const id = resolveSelectOptionId(entry, options)
      if (id !== null && !ids.includes(id)) ids.push(id)
    }
    return ids
  }
  // Tolerate an array left behind by a multiple→single toggle by resolving its
  // first element, rather than dropping the cell wholesale.
  const single = Array.isArray(value) ? value[0] : value
  return single === undefined ? null : resolveSelectOptionId(single, options)
}

/**
 * Normalizes caller-supplied select options to `{ id, name }` pairs.
 *
 * Cells reference the option id, so an edit that re-sends an option by name
 * must reuse the id it already has — minting a fresh one would orphan every
 * cell holding it, silently clearing the column. A caller that already supplies
 * an id keeps it, which makes this a no-op for the fully-formed options the
 * HTTP contracts accept and a repair for the name-only options agents author.
 */
export function normalizeSelectOptionsInput(
  raw: unknown,
  existing: SelectOption[] = []
): SelectOption[] | undefined {
  if (!Array.isArray(raw)) return undefined

  const idByName = new Map<string, string>()
  for (const option of existing) {
    const key = option.name.toLowerCase()
    if (!idByName.has(key)) idByName.set(key, option.id)
  }
  const resolveId = (name: string): string => idByName.get(name.toLowerCase()) ?? generateShortId()

  return raw.map((entry) => {
    if (typeof entry === 'string') return { id: resolveId(entry), name: entry }
    const e = (entry ?? {}) as { id?: unknown; name?: unknown }
    const name = typeof e.name === 'string' ? e.name : String(e.name ?? '')
    const id = typeof e.id === 'string' && e.id.length > 0 ? e.id : resolveId(name)
    return { id, name }
  })
}
