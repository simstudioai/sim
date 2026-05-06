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
  /**
   * When set, this column is one of a workflow group's outputs. The value in
   * `row.data[name]` is populated by the group's per-cell run.
   */
  workflowGroupId?: string
}

/** One workflow output → one plain column. */
export interface WorkflowGroupOutput {
  /** Source block id within the configured workflow. */
  blockId: string
  /** Dot-path into that block's output (e.g. `summary`, `result.items[0]`). */
  path: string
  /** Plain column in `schema.columns` that receives the plucked value. */
  columnName: string
}

export interface WorkflowGroupDependencies {
  /** Plain columns that must be non-empty before this group runs. */
  columns?: string[]
  /**
   * Other workflow groups that must reach `status: completed` before this
   * group runs. The dep graph is a first-class concept — you depend on a
   * producing group, never on a sibling output value (which can legitimately
   * be null on success).
   */
  workflowGroups?: string[]
}

export interface WorkflowGroup {
  id: string
  workflowId: string
  /** Display name; defaults to the workflow's name. */
  name?: string
  dependencies?: WorkflowGroupDependencies
  outputs: WorkflowGroupOutput[]
}

/**
 * Per-row execution state for one workflow group, stored in
 * `userTableRows.executions[groupId]`. Holds run metadata only — picked
 * values land in `row.data` directly.
 */
export interface RowExecutionMetadata {
  status: 'pending' | 'running' | 'completed' | 'error' | 'cancelled'
  executionId: string | null
  /**
   * Async-job id (e.g. trigger.dev run id) for the in-flight execution.
   * Persisted on `running` / `pending` rows so the cancel API can call
   * `backend.cancelJob(jobId)` from any pod regardless of which one
   * initiated the run. Null for terminal states.
   */
  jobId: string | null
  workflowId: string
  error: string | null
  /** Block ids currently mid-execution. Empty / absent on terminal states. */
  runningBlockIds?: string[]
  /**
   * Per-block error messages keyed by `blockId`. Errors are a normal Sim
   * concept (error-port edges) — only the column sourced from the failing
   * block should render `Error`, not every output column.
   */
  blockErrors?: Record<string, string>
}

/** Map of `WorkflowGroup.id` → execution state. Stored on every row. */
export type RowExecutions = Record<string, RowExecutionMetadata>

export interface TableSchema {
  columns: ColumnDefinition[]
  /**
   * Workflow groups keyed by id. Each group has N output columns (each
   * referenced by `outputs[].columnName` in this same schema).
   */
  workflowGroups?: WorkflowGroup[]
}

/**
 * Table-level metadata stored alongside the table definition. UI state only
 * (column widths, column order) — workflow-group concurrency is enforced at
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
  /** Per-group execution state for this row. Empty `{}` if nothing has run. */
  executions: RowExecutions
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
  /**
   * Optional partial patch to merge into `userTableRows.executions`. Top-level
   * keys are `WorkflowGroup.id`; pass `null` for a key to delete that group's
   * execution state. Used by the cell task and cancel paths.
   */
  executionsPatch?: Record<string, RowExecutionMetadata | null>
  /**
   * Optional SQL-level guard: the update is a no-op if the row's
   * `executions[groupId]` already shows `cancelled` for the same
   * `executionId`. The cell task passes this so a `running` partial-write
   * landing after a stop click can't clobber the authoritative `cancelled`
   * state. `updateRow` returns `null` when the guard rejects the write.
   */
  cancellationGuard?: { groupId: string; executionId: string }
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
  updates: Array<{
    rowId: string
    data: RowData
    executionsPatch?: Record<string, RowExecutionMetadata | null>
  }>
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

export interface DeleteColumnData {
  tableId: string
  columnName: string
}

/** Payload for `addWorkflowGroup` — atomic insert of a group + its outputs. */
export interface AddWorkflowGroupData {
  tableId: string
  group: WorkflowGroup
  outputColumns: ColumnDefinition[]
  /** When `false`, the post-add row-scheduling pass is skipped. Defaults to
   *  `true` (UI behavior). Mothership passes `false` so groups can be staged
   *  without firing every dep-satisfied row. */
  autoRun?: boolean
}

/** Payload for `updateWorkflowGroup` — diffs outputs and writes columns. */
export interface UpdateWorkflowGroupData {
  tableId: string
  groupId: string
  workflowId?: string
  name?: string
  dependencies?: WorkflowGroupDependencies
  /** Full replacement set; service computes adds/removes vs current state. */
  outputs?: WorkflowGroupOutput[]
  /** Column definitions for any newly-added outputs. */
  newOutputColumns?: ColumnDefinition[]
}

export interface DeleteWorkflowGroupData {
  tableId: string
  groupId: string
}
