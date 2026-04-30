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

export interface WorkflowColumnOutput {
  /** Source block id within the configured workflow. */
  blockId: string
  /** Dot-path into that block's output (e.g. `summary`, `result.items[0]`). */
  path: string
}

export interface WorkflowColumnConfig {
  workflowId: string
  /**
   * Explicit dependency list (column names). When set, overrides the scheduler's
   * default "all left non-workflow columns must be filled; upstream workflow
   * columns must be completed" predicate — only the listed columns are checked.
   */
  dependencies?: string[]
  /**
   * Outputs to display as visual columns. Each entry renders as its own column,
   * sharing one underlying execution per row. As each block completes the row's
   * `WorkflowCellValue.blockOutputs[blockId]` is populated, and the visual column
   * plucks `path` from there — so columns light up live as their source block
   * finishes. Must contain at least one entry.
   */
  outputs: WorkflowColumnOutput[]
}

export interface ColumnDefinition {
  name: string
  type: (typeof COLUMN_TYPES)[number]
  required?: boolean
  unique?: boolean
  workflowConfig?: WorkflowColumnConfig
}

export interface WorkflowCellValue {
  executionId: string | null
  /**
   * Async-job id (e.g. trigger.dev run id) for the in-flight execution. Persisted
   * on `running` cells so the cancel API can call `backend.cancelJob(jobId)` from
   * any pod regardless of which one initiated the run. Null for terminal states.
   */
  jobId?: string | null
  workflowId: string
  status: 'pending' | 'running' | 'completed' | 'error' | 'cancelled'
  output: unknown
  error: string | null
  /**
   * Per-block outputs accumulated as the workflow runs. Shape is
   * `{ [blockId]: { [path]: pluckedValue } }` — only the user's picked paths
   * from `column.workflowConfig.outputs` are persisted. The background
   * executor's `onBlockComplete` callback plucks each picked path from the
   * raw block result and writes it here, so visual columns sourced from
   * completed blocks light up before the whole workflow terminates.
   * Storing only the picked paths keeps cells small enough for the row-size
   * cap when multiple workflow columns share a row.
   */
  blockOutputs?: Record<string, Record<string, unknown>>
  /**
   * Block ids currently mid-execution. Maintained by the background executor via
   * `onBlockStart`/`onBlockComplete` partial writes. Lets fanned-out visual
   * columns distinguish "actively running" from "waiting upstream". Empty array
   * (or absent) on terminal states.
   */
  runningBlockIds?: string[]
  /**
   * Per-block error messages keyed by `blockId`. Errors are a normal Sim concept
   * (error-port edges) — only the column sourced from the failing block should
   * render `Error`, not every fanned-out column. Downstream blocks that never
   * ran stay empty rather than inheriting the workflow's overall error status.
   */
  blockErrors?: Record<string, string>
}

export interface TableSchema {
  columns: ColumnDefinition[]
}

/**
 * Table-level metadata stored alongside the table definition. UI state only
 * (column widths, column order) — workflow-column concurrency is enforced at
 * the trigger.dev queue layer, not via metadata.
 */
export interface TableMetadata {
  columnWidths?: Record<string, number>
  columnOrder?: string[]
}

export interface TableDefinition {
  id: string
  name: string
  description?: string | null
  schema: TableSchema
  metadata?: TableMetadata | null
  rowCount: number
  maxRows: number
  workspaceId: string
  createdBy: string
  archivedAt?: Date | string | null
  createdAt: Date | string
  updatedAt: Date | string
}

/** Minimal table info for UI components. */
export type TableInfo = Pick<TableDefinition, 'id' | 'name' | 'schema'>

/** Simplified table summary for LLM enrichment and display contexts. */
export interface TableSummary {
  name: string
  columns: Array<Pick<ColumnDefinition, 'name' | 'type'>>
}

export interface TableRow {
  id: string
  data: RowData
  position: number
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
  collapsed?: boolean
}

/**
 * UI builder state for a single sort rule.
 * Includes an `id` field for React keys.
 */
export interface SortRule {
  id: string
  column: string
  direction: SortDirection
  collapsed?: boolean
}

export interface QueryOptions {
  filter?: Filter
  sort?: Sort
  limit?: number
  offset?: number
  /**
   * When true (default), runs a `COUNT(*)` and returns `totalCount` as a number.
   * Pass `false` to skip the count query (grid UI doesn't need it); `totalCount`
   * is returned as `null` to signal it was not computed.
   */
  includeTotal?: boolean
}

export interface QueryResult {
  rows: TableRow[]
  rowCount: number
  totalCount: number | null
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
  /** Optional max rows override based on billing plan. Defaults to TABLE_LIMITS.MAX_ROWS_PER_TABLE. */
  maxRows?: number
  /** Optional max tables override based on billing plan. Defaults to TABLE_LIMITS.MAX_TABLES_PER_WORKSPACE. */
  maxTables?: number
  /** Number of empty rows to create with the table. Defaults to 0. */
  initialRowCount?: number
}

export interface InsertRowData {
  tableId: string
  data: RowData
  workspaceId: string
  userId?: string
  /** Optional explicit position. When omitted, the row is appended after the last position. */
  position?: number
}

export interface BatchInsertData {
  tableId: string
  rows: RowData[]
  workspaceId: string
  userId?: string
  /** Optional per-row target positions. Length must equal `rows.length`. */
  positions?: number[]
}

export interface UpsertRowData {
  tableId: string
  workspaceId: string
  data: RowData
  userId?: string
  /** Which unique column to match on. Required when multiple unique columns exist. */
  conflictTarget?: string
}

export interface UpsertResult {
  row: TableRow
  operation: 'insert' | 'update'
  previousData?: RowData
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

export interface BatchUpdateByIdData {
  tableId: string
  updates: Array<{ rowId: string; data: RowData }>
  workspaceId: string
}

export interface BulkDeleteData {
  tableId: string
  filter: Filter
  limit?: number
  workspaceId: string
}

export interface BulkDeleteByIdsData {
  tableId: string
  rowIds: string[]
  workspaceId: string
}

export interface BulkDeleteByIdsResult {
  deletedCount: number
  deletedRowIds: string[]
  requestedCount: number
  missingRowIds: string[]
}

export interface ReplaceRowsData {
  tableId: string
  rows: RowData[]
  workspaceId: string
  userId?: string
}

export interface ReplaceRowsResult {
  deletedCount: number
  insertedCount: number
}

export interface RenameColumnData {
  tableId: string
  oldName: string
  newName: string
}

export interface UpdateColumnTypeData {
  tableId: string
  columnName: string
  newType: (typeof COLUMN_TYPES)[number]
}

export interface UpdateColumnConstraintsData {
  tableId: string
  columnName: string
  required?: boolean
  unique?: boolean
}

export interface UpdateColumnWorkflowConfigData {
  tableId: string
  columnName: string
  workflowConfig: WorkflowColumnConfig
}

export interface DeleteColumnData {
  tableId: string
  columnName: string
}
