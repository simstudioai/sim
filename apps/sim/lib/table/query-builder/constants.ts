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
 * against the whole array can never be true. Mirrors the server-side whitelist
 * in `lib/table/sql.ts`, which rejects anything else outright.
 */
export const SINGLE_SELECT_FILTER_OPERATORS = new Set<string>(['eq', 'ne', 'isEmpty', 'isNotEmpty'])
export const MULTI_SELECT_FILTER_OPERATORS = new Set<string>([
  'contains',
  'ncontains',
  'isEmpty',
  'isNotEmpty',
])

export const LOGICAL_OPERATORS = [
  { value: 'and', label: 'and' },
  { value: 'or', label: 'or' },
] as const

export const SORT_DIRECTIONS = [
  { value: 'asc', label: 'ascending' },
  { value: 'desc', label: 'descending' },
] as const
