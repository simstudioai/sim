/**
 * Core type definitions for user-defined tables.
 *
 * @module lib/table/types
 */

import type { COLUMN_TYPES } from './constants'

/** Primitive values that can be stored in table columns */
export type ColumnValue = string | number | boolean | null | Date

/** JSON-compatible value for complex column types */
export type JsonValue = ColumnValue | JsonValue[] | { [key: string]: JsonValue }

/** Row data structure for insert/update operations */
export type RowData = Record<string, JsonValue>

/** Sort direction for query operations */
export type SortDirection = 'asc' | 'desc'

/** Sort specification mapping column names to sort direction */
export type SortSpec = Record<string, SortDirection>

/**
 * Column definition within a table schema.
 */
export interface ColumnDefinition {
  /** Column name (must match NAME_PATTERN) */
  name: string
  /** Data type for the column */
  type: (typeof COLUMN_TYPES)[number]
  /** Whether the column is required (non-null) */
  required?: boolean
  /** Whether the column must have unique values */
  unique?: boolean
}

/**
 * Table schema definition containing column specifications.
 */
export interface TableSchema {
  /** Array of column definitions */
  columns: ColumnDefinition[]
}

/**
 * Complete table definition including metadata.
 */
export interface TableDefinition {
  /** Unique table identifier */
  id: string
  /** Human-readable table name */
  name: string
  /** Optional table description */
  description?: string | null
  /** Table schema with column definitions */
  schema: TableSchema
  /** Current number of rows in the table */
  rowCount: number
  /** Maximum allowed rows (from TABLE_LIMITS) */
  maxRows: number
  /** Workspace the table belongs to */
  workspaceId: string
  /** ISO timestamp of creation */
  createdAt: Date | string
  /** ISO timestamp of last update */
  updatedAt: Date | string
}

/**
 * Row stored in a user-defined table.
 */
export interface TableRow {
  /** Unique row identifier */
  id: string
  /** Row data as key-value pairs */
  data: RowData
  /** ISO timestamp of creation */
  createdAt: Date | string
  /** ISO timestamp of last update */
  updatedAt: Date | string
}

/**
 * Filter operator conditions for query filtering.
 * Supports MongoDB-style query operators.
 */
export interface FilterOperators {
  /** Equal to */
  $eq?: ColumnValue
  /** Not equal to */
  $ne?: ColumnValue
  /** Greater than (numbers only) */
  $gt?: number
  /** Greater than or equal (numbers only) */
  $gte?: number
  /** Less than (numbers only) */
  $lt?: number
  /** Less than or equal (numbers only) */
  $lte?: number
  /** Value in array */
  $in?: ColumnValue[]
  /** Value not in array */
  $nin?: ColumnValue[]
  /** String contains (case-insensitive) */
  $contains?: string
}

/**
 * Query filter for table rows.
 * Keys are column names, values are either direct values or filter operators.
 */
export interface QueryFilter {
  /** Logical OR of multiple filters */
  $or?: QueryFilter[]
  /** Logical AND of multiple filters */
  $and?: QueryFilter[]
  /** Column filters */
  [key: string]: ColumnValue | FilterOperators | QueryFilter[] | undefined
}

/**
 * Result of a validation operation.
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean
  /** Array of error messages (empty if valid) */
  errors: string[]
}

/**
 * Options for querying table rows.
 */
export interface QueryOptions {
  /** Filter criteria */
  filter?: QueryFilter
  /** Sort specification */
  sort?: SortSpec
  /** Maximum rows to return */
  limit?: number
  /** Number of rows to skip */
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
  /** Number of rows affected */
  affectedCount: number
  /** IDs of affected rows */
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
  /** Table ID */
  tableId: string
  /** Row data */
  data: RowData
  /** Workspace ID */
  workspaceId: string
}

/**
 * Data required for batch row insertion.
 */
export interface BatchInsertData {
  /** Table ID */
  tableId: string
  /** Array of row data */
  rows: RowData[]
  /** Workspace ID */
  workspaceId: string
}

/**
 * Data required to update a row.
 */
export interface UpdateRowData {
  /** Table ID */
  tableId: string
  /** Row ID to update */
  rowId: string
  /** Full row data replacement */
  data: RowData
  /** Workspace ID */
  workspaceId: string
}

/**
 * Data required for bulk update by filter.
 */
export interface BulkUpdateData {
  /** Table ID */
  tableId: string
  /** Filter to match rows */
  filter: QueryFilter
  /** Data to apply to matched rows */
  data: RowData
  /** Maximum rows to update */
  limit?: number
  /** Workspace ID */
  workspaceId: string
}

/**
 * Data required for bulk delete by filter.
 */
export interface BulkDeleteData {
  /** Table ID */
  tableId: string
  /** Filter to match rows */
  filter: QueryFilter
  /** Maximum rows to delete */
  limit?: number
  /** Workspace ID */
  workspaceId: string
}
