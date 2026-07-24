/**
 * Select-column value translation between stored option **ids** and human
 * **names**. Cells store option ids (a single id, or a `string[]` of ids when
 * `multiple`); the display value is the option `name`. Consumption surfaces
 * (exports, mounts, clipboard, tool/API reads) resolve id→name; filters that
 * accept a typed name resolve name→id.
 *
 * Single source of truth reused everywhere so no boundary re-implements it.
 */

import { getColumnId } from '@/lib/table/column-keys'
import type {
  ColumnDefinition,
  ConditionOperators,
  Filter,
  JsonValue,
  RowData,
} from '@/lib/table/types'
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

/**
 * Returns a copy of an id-keyed row with every `select` column's value resolved
 * from option id(s) to name(s). Non-select values are untouched. Used at read
 * boundaries that surface names (tool/API reads).
 */
export function resolveRowSelectValues(
  rowData: RowData,
  selectColumns: ColumnDefinition[]
): RowData {
  if (selectColumns.length === 0) return rowData
  const out: RowData = { ...rowData }
  for (const column of selectColumns) {
    const key = getColumnId(column)
    if (key in out) out[key] = selectValueToNames(column, out[key])
  }
  return out
}

/** Convenience: the `select` columns of a schema (single + multiple). */
export function selectColumnsOf(columns: ColumnDefinition[]): ColumnDefinition[] {
  return columns.filter((c) => c.type === 'select')
}

/** Resolves a single filter operand that may be an option name into its id. */
function resolveOperand(value: JsonValue, options: ColumnDefinition['options']): JsonValue {
  const id = resolveSelectOptionId(value, options ?? [])
  return id ?? value
}

/**
 * Returns a copy of an id-keyed filter with `select` field values resolved from
 * option name → id, so a filter typed/served with option names matches the
 * stored ids. Handles the equality shorthand, `$eq`/`$ne`/`$in`/`$nin`, and
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
