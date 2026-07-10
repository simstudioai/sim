/**
 * Shared column-naming helpers: collision-free name claiming (CSV/JSON import,
 * enrichment output naming) and block-output auto-derivation (the table
 * column-sidebar UI and the Copilot/Mothership `add_workflow_group` op).
 * Keeping one implementation means every path — importer, AI, or sidebar —
 * names columns the same way.
 */

import { TABLE_LIMITS } from '@/lib/table/constants'
import type { ColumnDefinition } from '@/lib/table/types'

/**
 * Claims a column name not present in `takenLower` (a set of LOWERCASED names,
 * matching the schema's case-insensitive uniqueness) by appending `_2`, `_3`, …
 * to `base` on collision. The base is trimmed so the suffixed result stays
 * within `MAX_COLUMN_NAME_LENGTH`. The chosen name is added (lowercased) to
 * `takenLower` before returning, so callers never hand-maintain the set's
 * casing convention.
 */
export function uniqueColumnName(base: string, takenLower: Set<string>): string {
  const claim = (name: string): string => {
    takenLower.add(name.toLowerCase())
    return name
  }
  if (!takenLower.has(base.toLowerCase())) return claim(base)
  for (let suffix = 2; ; suffix++) {
    const tail = `_${suffix}`
    const head = base.slice(0, TABLE_LIMITS.MAX_COLUMN_NAME_LENGTH - tail.length).trimEnd()
    const candidate = `${head}${tail}`
    if (!takenLower.has(candidate.toLowerCase())) return claim(candidate)
  }
}

/**
 * Slugifies a string into a `NAME_PATTERN`-safe column name. Lowercase,
 * non-alphanum runs collapse to `_`, leading digits get a `c_` prefix, empty
 * results fall back to `output`.
 */
export function slugifyColumnName(value: string): string {
  let slug = value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!slug) slug = 'output'
  if (/^[0-9]/.test(slug)) slug = `c_${slug}`
  return slug
}

/**
 * Pick a non-colliding column name for a block-output `path`. Uses the bare
 * path slug; on collision, appends `_0`, `_1`, … Like `uniqueColumnName`,
 * takes a set of LOWERCASED names and claims the chosen name into it (slugs
 * are already lowercase), so callers never hand-maintain the set.
 */
export function deriveOutputColumnName(path: string, takenLower: Set<string>): string {
  const claim = (name: string): string => {
    takenLower.add(name)
    return name
  }
  const base = slugifyColumnName(path)
  if (!takenLower.has(base)) return claim(base)
  for (let i = 0; i < 1000; i++) {
    const candidate = `${base}_${i}`
    if (!takenLower.has(candidate)) return claim(candidate)
  }
  return claim(`${base}_${Date.now()}`)
}

/**
 * Map a block-output leaf type onto a table column type. Block schemas use
 * a superset (`array`, `object`, etc.); anything outside the column-type
 * union falls back to `json`, the most permissive shape that still validates.
 */
export function columnTypeForLeaf(leafType: string | undefined): ColumnDefinition['type'] {
  switch (leafType) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'date':
    case 'json':
      return leafType
    default:
      return 'json'
  }
}
