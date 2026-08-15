/**
 * "Filter by cell value" — turns one cell into the filter conditions that keep
 * its row, and merges them into the active filter.
 *
 * Deliberately NOT in `converters.ts`: this reads the column-type registry,
 * which carries React icon references, and `converters.ts` is re-exported from
 * the `@/lib/table` barrel that server modules import. Import this module by
 * its own path.
 */

import { getColumnId } from '@/lib/table/column-keys'
import { filterOperatorsFor } from '@/lib/table/column-types/registry'
import { isEmptyCellValue } from '@/lib/table/deps'
import { UI_TO_WIRE_OPERATOR } from '@/lib/table/query-builder/constants'
import type {
  ColumnDefinition,
  FilterOp,
  JsonValue,
  Predicate,
  TablePredicate,
} from '@/lib/table/types'

/**
 * Builds the conditions that match every row whose `column` cell reads the same
 * as `value`. Empty when this cell cannot be expressed as a filter — an unknown
 * column, a structured value with no meaningful equality, or a column type that
 * rejects the operator the value needs.
 *
 * The raw stored value is carried through untouched rather than being rendered
 * to text and re-parsed: a `select`'s option id, a `date`'s stored string, and a
 * numeric-looking `string` cell all compare byte-exactly against what the write
 * path stored, which text round-tripping would coerce away.
 */
export function cellValueFilterConditions(
  column: ColumnDefinition | undefined,
  value: unknown
): Predicate[] {
  if (!column) return []

  const field = getColumnId(column)
  // `filterOperatorsFor` answers in wire operators (`$eq`), the filter grammar
  // in bare ones (`eq`) — `UI_TO_WIRE_OPERATOR` is the existing bridge.
  const allowed = filterOperatorsFor(column)
  const supports = (op: FilterOp) => !allowed || allowed.has(UI_TO_WIRE_OPERATOR[op] ?? `$${op}`)

  // An empty cell asks about emptiness — `''`, a JSON null and an emptied
  // multi-select's `[]` are all what the server's `isEmpty` matches.
  if (isEmptyCellValue(value)) {
    return supports('isEmpty') ? [{ field, op: 'isEmpty' }] : []
  }

  // A multi-select cell holds several option ids, so "the same as this cell"
  // is one membership test per id — equality against the whole array can never
  // be true. Every id must be filterable, or the row the user clicked would
  // not survive its own filter.
  if (Array.isArray(value)) {
    if (!supports('contains')) return []
    if (!value.every((id) => typeof id === 'string')) return []
    return value.map((id) => ({ field, op: 'contains', value: id }) satisfies Predicate)
  }

  // No equality to offer: `validateLeaf` in `query-builder/validate.ts` rejects
  // the containment operators on a `json` column outright, and a rejected
  // predicate would stay in state and 400 every later refetch. `json.coerce`
  // accepts anything, so its cells hold scalars too — the type, not the value
  // shape, is what decides. The `typeof` guard covers a structured value
  // reaching any other type.
  if (column.type === 'json' || typeof value === 'object') return []
  if (!supports('eq')) return []
  return [{ field, op: 'eq', value: value as JsonValue }]
}

/**
 * Narrows `current` with one cell's conditions.
 *
 * Existing top-level conditions on the same column are dropped first, so
 * filtering twice on one column swaps the value instead of ANDing two
 * equalities into a guaranteed-empty result. Conditions on other columns are
 * kept — the action narrows what the user is looking at rather than replacing
 * it.
 */
export function withCellValueFilter(
  current: TablePredicate | null,
  conditions: readonly Predicate[]
): TablePredicate {
  if (!current) return { all: [...conditions] }
  if ('all' in current) {
    const field = conditions[0]?.field
    const kept = current.all.filter((node) => !('field' in node && node.field === field))
    return { all: [...kept, ...conditions] }
  }
  // An `any` group is a whole disjunction — narrowing it means AND-ing the new
  // conditions onto the group, not reaching inside it.
  return { all: [current, ...conditions] }
}
