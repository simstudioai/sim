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
  PredicateNode,
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

  // A `json` column has no same-value filter to offer, whatever the cell holds.
  // It must be checked BEFORE the shape branches below: `json.coerce` accepts
  // anything, so a json cell holds arrays and scalars alike, and letting a
  // string array through the multi-select branch would emit `contains` — which
  // the server accepts on json and compiles to ILIKE substring matching, so
  // unrelated rows would match. `eq` there is refused outright by `validateLeaf`
  // in `query-builder/validate.ts`, and a refused predicate would stay in state
  // and 400 every later refetch. Only the emptiness check above survives.
  if (column.type === 'json') return []

  // A multi-select cell holds several option ids, so "the same as this cell"
  // is one membership test per id — equality against the whole array can never
  // be true. Every id must be filterable, or the row the user clicked would
  // not survive its own filter.
  if (Array.isArray(value)) {
    if (!supports('contains')) return []
    if (!value.every((id) => typeof id === 'string')) return []
    return value.map((id) => ({ field, op: 'contains', value: id }) satisfies Predicate)
  }

  // A structured value on any other column type has no meaningful equality.
  if (typeof value === 'object') return []
  if (!supports('eq')) return []
  return [{ field, op: 'eq', value: value as JsonValue }]
}

/** True when any leaf anywhere under `node` filters on `field`. */
function mentionsField(node: PredicateNode, field: string): boolean {
  if ('field' in node) return node.field === field
  const members = 'all' in node ? node.all : node.any
  return members.some((member) => mentionsField(member, field))
}

/**
 * Narrows `current` with one cell's conditions.
 *
 * Anything already constraining this column is dropped first, so filtering
 * twice on one column swaps the value instead of ANDing two conditions the
 * same row cannot satisfy — which would empty the table the user is looking at
 * and give them no clue why. Conditions on other columns are kept: the action
 * narrows the current view rather than replacing it.
 *
 * A whole nested group is dropped when it mentions the column ANYWHERE, not
 * just its top-level leaves. Reaching inside an `any` group to pull one leaf
 * out would silently WIDEN the user's disjunction — dropping the group loses
 * the other columns it mentioned, but it is visible in the panel afterwards
 * and never contradicts what was just asked for.
 */
export function withCellValueFilter(
  current: TablePredicate | null,
  conditions: readonly Predicate[]
): TablePredicate | null {
  // Nothing to add leaves the filter exactly as it was — an `{ all: [] }` group
  // is not a valid predicate and the server rejects it.
  const field = conditions[0]?.field
  if (field === undefined) return current
  if (!current) return { all: [...conditions] }
  const members = 'all' in current ? current.all : [current]
  return { all: [...members.filter((node) => !mentionsField(node, field)), ...conditions] }
}
