/**
 * Core type definitions for user-defined tables.
 */

import type { COLUMN_TYPES } from './constants'

/** Primitive values that can be stored in table columns */
export type ColumnValue = string | number | boolean | null | Date
export type JsonValue = ColumnValue | JsonValue[] | { [key: string]: JsonValue }

/** Row data structure for insert/update operations
 *  key is the column name and value is the value of the column
 *  value is a JSON-compatible value */
export type RowData = Record<string, JsonValue>

/** Sort direction for query operations */
export type SortDirection = 'asc' | 'desc'

/** Sort specification mapping column names to sort direction
 * "asc" for ascending and "desc" for descending
 * key is the column name and value is the sort direction */
export type Sort = Record<string, SortDirection>

/**
 * Option for column/dropdown selection in UI components.
 * Used by filter builders, sort builders, and column selectors.
 */
export interface ColumnOption {
  value: string
  label: string
}

/**
 * Column definition within a table schema.
 */
export interface ColumnDefinition {
  name: string
  type: (typeof COLUMN_TYPES)[number]
  required?: boolean
  unique?: boolean
}

/**
 * Table schema definition containing column specifications.
 */
export interface TableSchema {
  columns: ColumnDefinition[]
}

/**
 * Complete table definition including metadata.
 */
export interface TableDefinition {
  id: string
  name: string
  description?: string | null
  schema: TableSchema
  rowCount: number
  maxRows: number
  workspaceId: string
  createdBy: string
  createdAt: Date | string
  updatedAt: Date | string
}

/**
 * Subset of TableDefinition for UI components that only need basic info.
 */
export type TableInfo = Pick<TableDefinition, 'id' | 'name' | 'schema'>

/**
 * Row stored in a user-defined table.
 */
export interface TableRow {
  id: string
  data: RowData
  createdAt: Date | string
  updatedAt: Date | string
}

/**
 * Operators that form a condition for a field.
 * Supports MongoDB-style query operators.
 *
 * @example
 * // Single operator
 * { $eq: 'John' }           // field equals 'John'
 * { $gt: 18 }               // field greater than 18
 * { $in: ['active', 'pending'] }  // field in array
 * { $contains: 'search' }   // field contains 'search' (case-insensitive)
 *
 * // Multiple operators (all must match)
 * { $gte: 18, $lt: 65 }    // field >= 18 AND field < 65
 */
export interface ConditionOperators {
  $eq?: ColumnValue
  $ne?: ColumnValue
  $gt?: number
  $gte?: number
  $lt?: number
  $lte?: number
  $in?: ColumnValue[]
  $nin?: ColumnValue[]
  $contains?: string
}

/**
 * Filter for querying table rows.
 * Keys are column names, values are either direct values (shorthand for equality)
 * or ConditionOperators objects for complex conditions.
 *
 * @example
 * // Simple equality (shorthand - equivalent to { name: { $eq: 'John' } })
 * { name: 'John' }
 *
 * // Using ConditionOperators for a single field
 * { age: { $gt: 18 } }
 * { status: { $in: ['active', 'pending'] } }
 *
 * // Multiple fields (AND logic)
 * { name: 'John', age: { $gte: 18 } }  // name = 'John' AND age >= 18
 *
 * // Logical OR
 * { $or: [
 *   { status: 'active' },
 *   { status: 'pending' }
 * ]}
 *
 * // Logical AND
 * { $and: [
 *   { age: { $gte: 18 } },
 *   { verified: true }
 * ]}
 *
 * // Nested logical operators
 * { $or: [
 *   { $and: [{ status: 'active' }, { age: { $gte: 18 } }] },
 *   { role: 'admin' }
 * ]}
 */
export interface Filter {
  $or?: Filter[]
  $and?: Filter[]
  [key: string]: ColumnValue | ConditionOperators | Filter[] | undefined
}

/**
 * Result of a validation operation. The list of errors are used to display to the user.
 */
export interface ValidationResult {
  valid: boolean
  errors: string[]
}

// ============================================================================
// UI Builder Types
// These types represent the state of filter/sort builder UI components.
// They have `id` fields for React keys and string values for form inputs.
// Use the conversion utilities in filters/utils.ts to convert to API types.
// ============================================================================

/**
 * Single filter condition in the UI builder.
 * This is the UI representation - use `Filter` for API queries.
 */
export interface FilterCondition {
  /** Unique identifier for the condition (used as React key) */
  id: string
  /** How this condition combines with the previous one */
  logicalOperator: 'and' | 'or'
  /** Column to filter on */
  column: string
  /** Comparison operator (eq, ne, gt, gte, lt, lte, contains, in) */
  operator: string
  /** Value to compare against (as string for form input) */
  value: string
}

/**
 * Single sort condition in the UI builder.
 * This is the UI representation - use `Sort` for API queries.
 */
export interface SortCondition {
  /** Unique identifier for the condition (used as React key) */
  id: string
  /** Column to sort by */
  column: string
  /** Sort direction */
  direction: SortDirection
}

/**
 * Options for querying table rows.
 */
export interface QueryOptions {
  filter?: Filter
  sort?: Sort
  limit?: number
  offset?: number
}

/**
 * Result of a row query operation.
 */
export interface QueryResult {
  /** Returned rows */
  rows: TableRow[]
  /** Number of rows returned */
  rowCount: number
  /** Total rows matching filter (before pagination) */
  totalCount: number
  /** Limit used in query */
  limit: number
  /** Offset used in query */
  offset: number
}

/**
 * Result of a bulk operation (update/delete by filter).
 */
export interface BulkOperationResult {
  affectedCount: number
  affectedRowIds: string[]
}

/**
 * Data required to create a new table.
 */
export interface CreateTableData {
  /** Table name */
  name: string
  /** Optional description */
  description?: string
  /** Table schema */
  schema: TableSchema
  /** Workspace ID */
  workspaceId: string
  /** User ID of creator */
  userId: string
}

/**
 * Data required to insert a row.
 */
export interface InsertRowData {
  tableId: string
  data: RowData
  workspaceId: string
}

/**
 * Data required for batch row insertion.
 */
export interface BatchInsertData {
  tableId: string
  rows: RowData[]
  workspaceId: string
}

/**
 * Data required to update a row.
 */
export interface UpdateRowData {
  tableId: string
  rowId: string
  data: RowData
  workspaceId: string
}

/**
 * Data required for bulk update by filter.
 */
export interface BulkUpdateData {
  tableId: string
  filter: Filter
  data: RowData
  limit?: number
  workspaceId: string
}

/**
 * Data required for bulk delete by filter.
 */
export interface BulkDeleteData {
  tableId: string
  filter: Filter
  limit?: number
  workspaceId: string
}
