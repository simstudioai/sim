/**
 * Select-column value translation between stored option **ids** and human
 * **names**. Cells store option ids (a single id, or a `string[]` of ids when
 * `multiple`); the display value is the option `name`.
 *
 * Row-level id→name translation lives in `cell-format.ts`, which fuses it with
 * the column key translation. What remains here is the reverse direction: a
 * filter operand typed as an option name resolving back to the stored id.
 */

import { getColumnId } from '@/lib/table/column-keys'
import type { ColumnDefinition, ConditionOperators, Filter, JsonValue } from '@/lib/table/types'
import { resolveSelectOptionId } from '@/lib/table/validation'

/**
 * Resolves a `select` cell's stored option id(s) to their display name(s). A
 * single column returns the option name (or null); a `multiple` column returns
 * an array of names. Ids with no matching option (deleted) are dropped.
 */
export function selectValueToNames(
  column: ColumnDefinition,
  value: unknown
): string | string[] | null {
  const byId = new Map((column.options ?? []).map((o) => [o.id, o.name]))
  const ids = Array.isArray(value)
    ? value
    : typeof value === 'string' && value !== ''
      ? [value]
      : []
  const names = ids
    .map((id) => (typeof id === 'string' ? byId.get(id) : undefined))
    .filter((n): n is string => n != null)
  return column.multiple ? names : (names[0] ?? null)
}

/** Resolves a single filter operand that may be an option name into its id. */
function resolveOperand(value: JsonValue, options: ColumnDefinition['options']): JsonValue {
  const id = resolveSelectOptionId(value, options ?? [])
  return id ?? value
}

/**
 * Returns a copy of an id-keyed filter with `select` field values resolved from
 * option name → id, so a filter typed/served with option names matches the
 * stored ids. Handles the equality shorthand, `$eq`/`$ne`/`$in`/`$nin`,
 * `$contains`/`$ncontains` (multi-select membership), and
 * nested `$and`/`$or`. Fields keyed by non-select columns pass through.
 */
export function resolveFilterSelectValues(filter: Filter, columns: ColumnDefinition[]): Filter {
  const selectById = new Map(
    columns.filter((c) => c.type === 'select').map((c) => [getColumnId(c), c])
  )
  const walk = (f: Filter): Filter => {
    const out: Filter = {}
    for (const [key, value] of Object.entries(f)) {
      if ((key === '$or' || key === '$and') && Array.isArray(value)) {
        out[key] = (value as Filter[]).map(walk)
        continue
      }
      const column = selectById.get(key)
      if (!column) {
        out[key] = value
        continue
      }
      const options = column.options
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const ops = value as ConditionOperators
        const next: ConditionOperators = { ...ops }
        if (ops.$eq !== undefined)
          next.$eq = resolveOperand(ops.$eq, options) as ConditionOperators['$eq']
        if (ops.$ne !== undefined)
          next.$ne = resolveOperand(ops.$ne, options) as ConditionOperators['$ne']
        if (Array.isArray(ops.$in))
          next.$in = ops.$in.map((v) => resolveOperand(v, options)) as ConditionOperators['$in']
        if (Array.isArray(ops.$nin))
          next.$nin = ops.$nin.map((v) => resolveOperand(v, options)) as ConditionOperators['$nin']
        // Multi-select asks membership, so its operands arrive under
        // `$contains`/`$ncontains` rather than `$eq`/`$ne`.
        if (ops.$contains !== undefined)
          next.$contains = resolveOperand(
            ops.$contains as JsonValue,
            options
          ) as ConditionOperators['$contains']
        if (ops.$ncontains !== undefined)
          next.$ncontains = resolveOperand(
            ops.$ncontains as JsonValue,
            options
          ) as ConditionOperators['$ncontains']
        out[key] = next
      } else {
        // Equality shorthand: `{ status: 'Open' }` → resolve to the id.
        out[key] = resolveOperand(value as JsonValue, options) as Filter[string]
      }
    }
    return out
  }
  return walk(filter)
}
