/**
 * Shared column-naming helpers used by every path that auto-derives a
 * column name + type from a workflow block output: the table column-sidebar
 * UI, and the Copilot/Mothership `add_workflow_group` op. Keeping one
 * implementation means the AI's auto-named columns match what a user would
 * get from the sidebar.
 */

import type { ColumnDefinition } from './types'

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
 * path slug; on collision, appends `_0`, `_1`, …
 */
export function deriveOutputColumnName(path: string, taken: Set<string>): string {
  const base = slugifyColumnName(path)
  if (!taken.has(base)) return base
  for (let i = 0; i < 1000; i++) {
    const candidate = `${base}_${i}`
    if (!taken.has(candidate)) return candidate
  }
  return `${base}_${Date.now()}`
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
