/**
 * Type definitions for user-defined tables.
 */

import type { COLUMN_TYPES } from './constants'

export type ColumnValue = string | number | boolean | null | Date
export type JsonValue = ColumnValue | JsonValue[] | { [key: string]: JsonValue }

/** Row data mapping column names to values. */
export type RowData = Record<string, JsonValue>

export type SortDirection = 'asc' | 'desc'

/** Sort specification mapping column names to direction. */
export type Sort = Record<string, SortDirection>

/** Option for dropdown/select components. */
export interface ColumnOption {
  value: string
  label: string
}

export interface ColumnDefinition {
  name: string
  type: (typeof COLUMN_TYPES)[number]
  required?: boolean
  unique?: boolean
}

export interface TableSchema {
  columns: ColumnDefinition[]
}

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

/** Minimal table info for UI components. */
export type TableInfo = Pick<TableDefinition, 'id' | 'name' | 'schema'>

export interface TableRow {
  id: string
  data: RowData
  createdAt: Date | string
  updatedAt: Date | string
}

/**
 * MongoDB-style query operators for field comparisons.
 *
 * @example
 * { $eq: 'John' }
 * { $gte: 18, $lt: 65 }
 * { $in: ['active', 'pending'] }
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
 * Filter object for querying table rows. Supports direct equality shorthand,
 * operator objects, and logical $or/$and combinators.
 *
 * @example
 * { name: 'John' }
 * { age: { $gte: 18 } }
 * { $or: [{ status: 'active' }, { status: 'pending' }] }
 */
export interface Filter {
  $or?: Filter[]
  $and?: Filter[]
  [key: string]: ColumnValue | ConditionOperators | Filter[] | undefined
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

/**
 * UI builder state for a single filter rule.
 * Includes an `id` field for React keys and string values for form inputs.
 */
export interface FilterRule {
  id: string
  logicalOperator: 'and' | 'or'
  column: string
  operator: string
  value: string
}

/**
 * UI builder state for a single sort rule.
 * Includes an `id` field for React keys.
 */
export interface SortRule {
  id: string
  column: string
  direction: SortDirection
}

export interface QueryOptions {
  filter?: Filter
  sort?: Sort
  limit?: number
  offset?: number
}

export interface QueryResult {
  rows: TableRow[]
  rowCount: number
  totalCount: number
  limit: number
  offset: number
}

export interface BulkOperationResult {
  affectedCount: number
  affectedRowIds: string[]
}

export interface CreateTableData {
  name: string
  description?: string
  schema: TableSchema
  workspaceId: string
  userId: string
}

export interface InsertRowData {
  tableId: string
  data: RowData
  workspaceId: string
}

export interface BatchInsertData {
  tableId: string
  rows: RowData[]
  workspaceId: string
}

export interface UpdateRowData {
  tableId: string
  rowId: string
  data: RowData
  workspaceId: string
}

export interface BulkUpdateData {
  tableId: string
  filter: Filter
  data: RowData
  limit?: number
  workspaceId: string
}

export interface BulkDeleteData {
  tableId: string
  filter: Filter
  limit?: number
  workspaceId: string
}
