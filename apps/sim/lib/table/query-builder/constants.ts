/**
 * Constants for table query builder UI (filtering and sorting).
 */

export type { FilterRule, SortRule } from '@/lib/table/types'

export const COMPARISON_OPERATORS = [
  { value: 'eq', label: 'equals' },
  { value: 'ne', label: 'not equals' },
  { value: 'contains', label: 'contains' },
  { value: 'ncontains', label: 'does not contain' },
  { value: 'startsWith', label: 'starts with' },
  { value: 'endsWith', label: 'ends with' },
  { value: 'gt', label: 'greater than' },
  { value: 'gte', label: 'greater or equal' },
  { value: 'lt', label: 'less than' },
  { value: 'lte', label: 'less or equal' },
  { value: 'in', label: 'in array' },
  { value: 'nin', label: 'not in array' },
  { value: 'isEmpty', label: 'is empty' },
  { value: 'isNotEmpty', label: 'is not empty' },
] as const

/**
 * Operators that take no value — the filter is fully specified by column +
 * operator alone. The UI hides the value input and skips the value-required
 * check for these, and the converter serializes them to `{ $empty: bool }`.
 */
export const VALUELESS_OPERATORS = new Set<string>(['isEmpty', 'isNotEmpty'])

/**
 * Operators a `select` column supports (values are opaque option ids). A
 * multi-select cell holds several ids, so it asks about membership — equality
 * against the whole array can never be true.
 *
 * These must stay in step with the server whitelist in `lib/table/sql.ts`: the
 * filter picker offers exactly these, and `pruneFilterForColumns` /
 * `prunePredicateForColumns` DROP
 * anything outside them, so an operator missing here is silently discarded from
 * a filter the server would have accepted. `sql.test.ts` asserts the two sets
 * agree through `UI_TO_WIRE_OPERATOR` rather than leaving it to a comment.
 */
export const SINGLE_SELECT_FILTER_OPERATORS = new Set<string>([
  'eq',
  'ne',
  'in',
  'nin',
  'isEmpty',
  'isNotEmpty',
])
export const MULTI_SELECT_FILTER_OPERATORS = new Set<string>([
  'contains',
  'ncontains',
  'isEmpty',
  'isNotEmpty',
])

/**
 * UI operator → wire operator. `isEmpty`/`isNotEmpty` both serialize to
 * `$empty` (they differ only in the boolean payload); every other operator is
 * its own name prefixed with `$`, matching `toRuleValue`.
 */
export const UI_TO_WIRE_OPERATOR: Record<string, string> = {
  isEmpty: '$empty',
  isNotEmpty: '$empty',
}

export const LOGICAL_OPERATORS = [
  { value: 'and', label: 'and' },
  { value: 'or', label: 'or' },
] as const

/**
 * Direction picker options for the sort-builder UI. Distinct from the wire-level
 * `SORT_DIRECTIONS` tuple in `lib/table/constants.ts` — both are star-exported
 * through `lib/table/index.ts`, and a duplicate name resolves to nothing there.
 */
export const SORT_DIRECTION_OPTIONS = [
  { value: 'asc', label: 'ascending' },
  { value: 'desc', label: 'descending' },
] as const
