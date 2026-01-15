/**
 * Shared constants and types for table filtering and sorting.
 *
 * @module lib/table/filter-constants
 *
 * @remarks
 * This is the single source of truth for all filter and sort constants.
 * All components should import from here to ensure consistency.
 */

/**
 * Available comparison operators for filter conditions.
 *
 * @remarks
 * These operators map to the query builder operators in query-builder.ts
 */
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
 * Sort direction options.
 */
export const SORT_DIRECTIONS = [
  { value: 'asc', label: 'ascending' },
  { value: 'desc', label: 'descending' },
] as const

/**
 * Represents a single filter condition.
 *
 * @remarks
 * Used by filter builder UI components to construct filter queries.
 */
export interface FilterCondition {
  /** Unique identifier for the condition (used as React key) */
  id: string
  /** How this condition combines with the previous one */
  logicalOperator: 'and' | 'or'
  /** Column to filter on */
  column: string
  /** Comparison operator */
  operator: string
  /** Value to compare against */
  value: string
}

/**
 * Represents a sort configuration.
 */
export interface SortCondition {
  /** Unique identifier for the condition (used as React key) */
  id: string
  /** Column to sort by */
  column: string
  /** Sort direction */
  direction: 'asc' | 'desc'
}

/**
 * Generates a unique ID for filter or sort conditions.
 * Used as React keys for list items in builder UI.
 *
 * @returns Random alphanumeric string
 */
export function generateConditionId(): string {
  return Math.random().toString(36).substring(2, 9)
}
