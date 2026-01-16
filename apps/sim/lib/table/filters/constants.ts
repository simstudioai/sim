/**
 * Shared constants for table filtering and sorting UI.
 *
 * Types (FilterCondition, SortCondition) are defined in ../types.ts
 * and re-exported here for convenience.
 */

// Re-export UI builder types from central types file
export type { FilterCondition, SortCondition } from '../types'

/** Comparison operators for filter conditions (maps to ConditionOperators in types.ts) */
export const COMPARISON_OPERATORS = [
  { value: 'eq', label: 'equals' },
  { value: 'ne', label: 'not equals' },
  { value: 'gt', label: 'greater than' },
  { value: 'gte', label: 'greater or equal' },
  { value: 'lt', label: 'less than' },
  { value: 'lte', label: 'less or equal' },
  { value: 'contains', label: 'contains' },
  { value: 'in', label: 'in array' },
] as const

/**
 * Logical operators for combining filter conditions.
 */
export const LOGICAL_OPERATORS = [
  { value: 'and', label: 'and' },
  { value: 'or', label: 'or' },
] as const

/**
 * Sort direction options for UI dropdowns.
 */
export const SORT_DIRECTIONS = [
  { value: 'asc', label: 'ascending' },
  { value: 'desc', label: 'descending' },
] as const
