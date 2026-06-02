/**
 * Constants for table query builder UI (filtering and sorting).
 */

export type { FilterRule, SortRule } from '../types'

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

export const LOGICAL_OPERATORS = [
  { value: 'and', label: 'and' },
  { value: 'or', label: 'or' },
] as const

export const SORT_DIRECTIONS = [
  { value: 'asc', label: 'ascending' },
  { value: 'desc', label: 'descending' },
] as const
