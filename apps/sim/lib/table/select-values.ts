/**
 * Select-column value translation between stored option **ids** and human
 * **names**. Cells store option ids (a single id, or a `string[]` of ids when
 * `multiple`); the display value is the option `name`.
 *
 * Row-level id→name translation lives in `cell-format.ts`, which fuses it with
 * the column key translation. What remains here is the reverse direction: a
 * filter operand typed as an option name resolving back to the stored id — in
 * both the legacy `$` grammar and the v2 predicate tree.
 */

import { buildIdByName, getColumnId, predicateNamesToIds } from '@/lib/table/column-keys'
import type {
  ColumnDefinition,
  ConditionOperators,
  Filter,
  FilterOp,
  JsonValue,
  Predicate,
  PredicateNode,
  TablePredicate,
  TableSchema,
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

/**
 * Predicate-grammar sibling of {@link resolveFilterSelectValues}: returns a copy
 * of an id-keyed predicate tree with `select` leaf values resolved from option
 * name → id.
 *
 * Without it a v2 filter written against a select column (`{field:'status',
 * op:'eq', value:'Open'}`) compares the option NAME against the stored option
 * ID and silently matches nothing.
 *
 * Mirrors the `$`-grammar set exactly: equality/membership on a single select
 * (`eq`/`ne`/`in`/`nin`) AND `contains`/`ncontains`, which on a MULTI-select are
 * not pattern matches at all — the cell is an array of option ids, so those ops
 * express membership and their operand is an option, not a substring. Leaving
 * them out is what made a correctly-formed multi-select filter match nothing.
 * The remaining pattern ops (`like`, `startsWith`, …) are rejected on select
 * columns by `fieldPredicate`'s allowlist, so they never reach here. The
 * valueless ops carry nothing to resolve.
 */
export function resolvePredicateSelectValues(
  predicate: TablePredicate,
  columns: ColumnDefinition[]
): TablePredicate {
  const selectById = new Map(
    columns.filter((c) => c.type === 'select').map((c) => [getColumnId(c), c])
  )
  if (selectById.size === 0) return predicate

  const RESOLVED_OPS = new Set<FilterOp>(['eq', 'ne', 'in', 'nin', 'contains', 'ncontains'])

  const walk = (node: PredicateNode): PredicateNode => {
    if ('all' in node) return { all: node.all.map(walk) }
    if ('any' in node) return { any: node.any.map(walk) }

    const leaf = node as Predicate
    const column = selectById.get(leaf.field)
    if (!column || leaf.value === undefined || !RESOLVED_OPS.has(leaf.op)) return leaf

    const options = column.options
    const value = Array.isArray(leaf.value)
      ? leaf.value.map((v) => resolveOperand(v as JsonValue, options))
      : resolveOperand(leaf.value as JsonValue, options)
    return { ...leaf, value: value as Predicate['value'] }
  }

  return walk(predicate) as TablePredicate
}

/**
 * The complete name-keyed → storage-keyed translation for a v2 predicate:
 * column names become column ids AND select operands become option ids.
 *
 * Both halves are required and neither is useful alone, but they lived as two
 * separate calls that every boundary had to remember to pair — and three of them
 * did not, so a filter on a select column compared an option NAME against a
 * stored option ID and returned zero rows while reporting success. Call this
 * instead of `predicateNamesToIds` so the pair cannot be split again.
 */
export function predicateToStorage(predicate: TablePredicate, schema: TableSchema): TablePredicate {
  return resolvePredicateSelectValues(
    predicateNamesToIds(predicate, buildIdByName(schema)),
    schema.columns
  )
}
