/**
 * Type definitions for user-defined tables.
 */

import type { COLUMN_TYPES } from '@/lib/table/constants'

export type ColumnValue = string | number | boolean | null | Date
export type JsonValue = ColumnValue | JsonValue[] | { [key: string]: JsonValue }

/**
 * Row data mapping **column id** → value at rest (in `user_table_rows.data`).
 * The two name-translating boundaries (public v1 API, mothership tool) and CSV
 * key by column name on the wire; everything else uses ids. Resolve a column's
 * storage key with `getColumnId` from `./column-keys`.
 */
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
  /**
   * Stable storage key for this column. Row data, metadata, workflow-group
   * refs, and filter/sort all key on this id; `name` is a pure display label
   * that can change freely (rename is metadata-only). Absent only on legacy
   * columns before the backfill — `getColumnId` falls back to `name`, which is
   * the key those rows were already written under. New columns get a generated
   * `col_…` from `generateColumnId`.
   */
  id?: string
  name: string
  type: (typeof COLUMN_TYPES)[number]
  required?: boolean
  unique?: boolean
  /**
   * When set, this column is one of a workflow group's outputs. The value in
   * `row.data[getColumnId(col)]` is populated by the group's per-cell run.
   */
  workflowGroupId?: string
}

/** One group output → one plain column. */
export interface WorkflowGroupOutput {
  /** Source block id within the configured workflow. `''` for enrichment groups. */
  blockId: string
  /** Dot-path into that block's output. `''` for enrichment groups. */
  path: string
  /** Enrichment output id this column receives (enrichment groups only). */
  outputId?: string
  /**
   * Stable **column id** (`getColumnId`) of the plain column in
   * `schema.columns` that receives the produced value. Despite the field name,
   * this holds the column id, not its display name — so a column rename never
   * touches this ref. Legacy values equal the column name (== id pre-backfill).
   */
  columnName: string
}

export interface WorkflowGroupDependencies {
  /**
   * Stable **column ids** (`getColumnId`) that must be non-empty before this
   * group runs. Workflow output columns count too — once an upstream group
   * fills its output column, any downstream group depending on that column
   * becomes eligible. The user model is uniform: deps are columns, not
   * group-completion edges. Legacy values equal column names (== id pre-backfill).
   */
  columns?: string[]
}

/**
 * How the group was created. `'manual'` groups are user-built workflow columns;
 * `'enrichment'` groups are spawned from a shared enrichment template and hide
 * launch / input-editing affordances in the config sidebar. Defaults to
 * `'manual'` when absent (pre-feature groups).
 */
export type WorkflowGroupType = 'manual' | 'enrichment'

/**
 * Which workflow state a group's per-cell runs execute against: `'live'` runs
 * the editable draft (current behavior); `'deployed'` runs the workflow's
 * latest active deployment. Defaults to `'live'` when absent.
 */
export type WorkflowGroupDeploymentMode = 'live' | 'deployed'

/** One workflow Start-block input field ← one table column. */
export interface WorkflowGroupInputMapping {
  /** `inputFormat` field name on the workflow's Start block. */
  inputName: string
  /**
   * Stable **column id** (`getColumnId`) whose per-row value feeds that input.
   * Despite the field name, this holds the column id, not its display name.
   * Legacy values equal the column name (== id pre-backfill).
   */
  columnName: string
}

export interface WorkflowGroup {
  id: string
  /** Backing workflow id for `manual` groups. `''` for enrichment groups. */
  workflowId: string
  /** Registry enrichment id for `enrichment` groups. */
  enrichmentId?: string
  /** Display name; defaults to the workflow's / enrichment's name. */
  name?: string
  /** Provenance of the group. Defaults to `'manual'` when absent. */
  type?: WorkflowGroupType
  dependencies?: WorkflowGroupDependencies
  outputs: WorkflowGroupOutput[]
  /**
   * Maps the workflow's Start-block input fields to the table columns that
   * supply each per-row value. Absent / empty means no mapping configured yet.
   */
  inputMappings?: WorkflowGroupInputMapping[]
  /**
   * Which workflow state per-cell runs execute against. Defaults to `'live'`
   * (editable draft) when absent. `'deployed'` runs the workflow's latest
   * active deployment. Only meaningful for `manual` groups.
   */
  deploymentMode?: WorkflowGroupDeploymentMode
  /**
   * When `false`, the group never auto-fires from the scheduler — it can only
   * be triggered manually via the "Run" actions. Defaults to `true` so
   * existing groups keep firing on dep satisfaction. Persisted alongside the
   * group definition; the scheduler reads it in `isGroupEligible`.
   */
  autoRun?: boolean
}

/**
 * State of one provider in an enrichment cascade run. `matched`/`no_match`/
 * `error` actually called the tool; `skipped` had insufficient inputs; `not_run`
 * was never reached because an earlier provider matched.
 */
export type EnrichmentProviderStatus = 'matched' | 'no_match' | 'skipped' | 'error' | 'not_run'

/**
 * Outcome of one provider attempt in an enrichment cascade, for the enrichment
 * details panel. The full configured cascade is recorded: `skipped` providers
 * had insufficient inputs, `not_run` providers sit after the match.
 */
export interface EnrichmentProviderOutcome {
  /** Provider id, e.g. `'hunter'`. */
  id: string
  /** Human label, e.g. `'Hunter'`. */
  label: string
  /** Tool id the provider runs, e.g. `'hunter_find_email'` — resolves the block
   *  icon for the details panel. */
  toolId: string
  status: EnrichmentProviderStatus
  /** Hosted-key cost (USD) this provider incurred; `0` for skip / no_match / error / BYOK. */
  cost: number
  /** Wall-clock ms this provider's tool call took; `0` for skipped. */
  durationMs: number
  /** Error message when `status === 'error'`, else `null`. */
  error: string | null
}

/**
 * Per-(row, group) cascade breakdown for an enrichment run, surfaced in the
 * enrichment details panel. Persisted on the `tableRowExecutions` sidecar but
 * deliberately kept out of the hot grid read path (fetched on demand) — it can
 * carry a dozen provider outcomes per cell.
 */
export interface EnrichmentRunDetail {
  /** ISO timestamp when the cascade started. */
  startedAt: string
  /** ISO timestamp when the cascade finished. */
  completedAt: string
  /** Wall-clock ms across the whole cascade. */
  durationMs: number
  /** Sum of per-provider hosted-key cost (USD). */
  totalCost: number
  /** Provider id that produced the match, or `null` on no match. */
  matchedProvider: string | null
  /** True when the run was cancelled (stop / signal abort) — drives a
   *  "Cancelled" result rather than inferring no-match/not-run from the cascade. */
  aborted: boolean
  /** Every configured provider, in cascade order (including `not_run` ones). */
  providers: EnrichmentProviderOutcome[]
}

/**
 * Per-row execution state for one workflow group, persisted as a row in the
 * `tableRowExecutions` sidecar keyed by `(rowId, groupId)`. Holds run
 * metadata only — picked output values land in `row.data` directly.
 */
export interface RowExecutionMetadata {
  status: 'pending' | 'queued' | 'running' | 'completed' | 'error' | 'cancelled'
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
  /** ISO timestamp set when a cell is cancelled. The dispatcher skips
   *  re-runs whose `cancelledAt > dispatch.requestedAt` — a user cancel
   *  mid-dispatch must not be overridden by `isManualRun`. */
  cancelledAt?: string
  /**
   * Enrichment cascade breakdown for `enrichment`-type groups, written on the
   * terminal cell write. Persisted on `tableRowExecutions` but NOT hydrated by
   * `loadExecutionsByRow` (kept off the hot grid read) — read it on demand via
   * `loadEnrichmentDetail` for the details panel.
   */
  enrichmentDetails?: EnrichmentRunDetail | null
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
 * (column widths, column order, pinned columns) — workflow-group concurrency
 * is enforced at the trigger.dev queue layer, not via metadata.
 */
export interface TableMetadata {
  /** Pixel widths keyed by **column id** (`getColumnId`). */
  columnWidths?: Record<string, number>
  /** Visible left-to-right order as **column ids** (`getColumnId`). */
  columnOrder?: string[]
  /** **Column ids** pinned to the left while scrolling horizontally. */
  pinnedColumns?: string[]
}

/** Async background-job lifecycle state for a table. NULL/undefined = idle (no job). */
export type TableJobStatus = 'running' | 'ready' | 'failed' | 'canceled'

/**
 * Which kind of background job a `table_jobs` row tracks. `import`, `delete`, and `backfill`
 * mutate row data and share the single-running-job gate; `export` is read-only and bypasses it
 * (the partial-unique index excludes it), so an export can run alongside any other job.
 */
export type TableJobType = 'import' | 'delete' | 'export' | 'backfill' | 'update'

/**
 * Persisted scope of a running delete job (`table_jobs.payload`). Defines the doomed row set —
 * `matches(filter) AND created_at <= cutoff AND id NOT IN excludeRowIds` — so the rows read-path
 * can mask those rows out while the job runs, making mid-job reads (refresh, other clients)
 * consistent with the eventual result.
 */
export interface TableDeleteJobPayload {
  filter?: Filter
  excludeRowIds?: string[]
  /** ISO timestamp; rows created after it are spared. */
  cutoff: string
  /** Doomed-row estimate captured at kickoff — display-only: list/detail counts subtract the
   *  not-yet-deleted remainder (doomedCount - rows_processed) while the job runs. Set only for an
   *  unbounded delete (the masked "delete everything matching" path); omitted when `maxRows` is set. */
  doomedCount?: number
  /**
   * Stop after deleting this many rows (an explicit caller-supplied limit above the inline cap).
   * Omitted = delete every match. When set, reads are NOT masked: the delete is eventually
   * consistent (rows disappear as they're deleted) like a bounded update, because the filter-based
   * mask would over-hide the rows beyond the cap that this job never deletes.
   */
  maxRows?: number
}

/**
 * Persisted scope of a running bulk-update job (`table_jobs.payload`): the same `data` patch is
 * merged into every row matching `filter` with `created_at <= cutoff` (so mid-job inserts are
 * spared, matching the delete job's snapshot semantics). `affectedCount` is the kickoff estimate,
 * display-only. Unlike delete, reads are not masked — updated rows still exist, so a background
 * update is eventually consistent (readers may see a mix of patched/unpatched rows mid-job).
 */
export interface TableUpdateJobPayload {
  filter: Filter
  /** Column-id-keyed partial patch applied to every matched row (JSONB merge). */
  data: RowData
  /** ISO timestamp; rows created after it are not patched. */
  cutoff: string
  affectedCount?: number
  /** Stop after updating this many rows (an explicit caller-supplied limit). Omitted = every match. */
  maxRows?: number
}

/**
 * Persisted scope of an export job (`table_jobs.payload`). `resultKey` is merged in by the worker
 * on completion — the storage key of the generated file, served to the client via a presigned URL
 * and deleted by the janitor when the terminal job is pruned.
 */
export interface TableExportJobPayload {
  format: 'csv' | 'json'
  resultKey?: string
}

/**
 * Keyset cursor for paginating a table's default row order, `(order_key, id)`. The grid's
 * infinite scroll threads this instead of an OFFSET — offset paging re-scans every prior row per
 * page (O(N²) to drain a table); the cursor makes each page an index seek on
 * `(table_id, order_key, id)`. Only valid for the default order: sorted views fall back to offset.
 */
export interface TableRowsCursor {
  orderKey: string
  id: string
}

/** Persisted scope of an output-column backfill job (`table_jobs.payload`). */
export interface TableBackfillJobPayload {
  groupId: string
  outputs: WorkflowGroupOutput[]
  /** Remaps overwrite existing cell values; added columns never clobber hand-edits. */
  overwrite: boolean
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
  /**
   * Async background-job state, derived from the table's latest `table_jobs` row (running if any,
   * else the most recent terminal). See `import-runner.ts` / `delete-runner.ts`.
   */
  jobStatus?: TableJobStatus | null
  jobId?: string | null
  jobType?: TableJobType | null
  jobError?: string | null
  jobRowsProcessed?: number
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
  /**
   * Fractional order key — the authoritative row order. Absent only for rows not
   * yet backfilled (clients fall back to `position`).
   */
  orderKey?: string
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
  $gt?: number | string
  $gte?: number | string
  $lt?: number | string
  $lte?: number | string
  $in?: ColumnValue[]
  $nin?: ColumnValue[]
  $contains?: string
  /** Case-insensitive negated substring match. Null/empty cells match. */
  $ncontains?: string
  /** Case-insensitive prefix match. */
  $startsWith?: string
  /** Case-insensitive suffix match. */
  $endsWith?: string
  /** `true` → cell is null or empty string; `false` → cell is present and non-empty. */
  $empty?: boolean
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
  /** Keyset cursor for the default `(order_key, id)` order — see {@link TableRowsCursor}.
   *  Mutually exclusive with `sort` and `offset`; takes precedence over `offset` when set. */
  after?: TableRowsCursor
  /**
   * When true (default), runs a `COUNT(*)` and returns `totalCount` as a number.
   * Pass `false` to skip the count query (grid UI doesn't need it); `totalCount`
   * is returned as `null` to signal it was not computed.
   */
  includeTotal?: boolean
  /**
   * When true (default), each returned row's `executions` is populated from the
   * `tableRowExecutions` sidecar. Pass `false` to skip the join and return `{}`
   * (the public v1 route does not expose executions).
   */
  withExecutions?: boolean
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
  /** Optional stored row cap. Vestigial under plan-based enforcement (the column is no longer
   *  consulted on insert), but retained so callers that still set it type-check. */
  maxRows?: number
  /** Optional max tables override based on billing plan. Defaults to TABLE_LIMITS.MAX_TABLES_PER_WORKSPACE. */
  maxTables?: number
  /** Number of empty rows to create with the table. Defaults to 0. */
  initialRowCount?: number
  /** When set, the table is created with this job already running (rows hidden until ready). */
  jobStatus?: TableJobStatus
  /** Job kind, paired with `jobStatus` (create-mode import sets `'import'`). */
  jobType?: TableJobType
  /** Async job id stamped on the table when `jobStatus` is set. */
  jobId?: string
}

export interface InsertRowData {
  tableId: string
  data: RowData
  workspaceId: string
  userId?: string
  /** Optional explicit position. When omitted, the row is appended after the last position. */
  position?: number
  /** Insert directly after this row (fractional ordering). Takes precedence over `position`. */
  afterRowId?: string
  /** Insert directly before this row (fractional ordering). Takes precedence over `position`. */
  beforeRowId?: string
}

export interface BatchInsertData {
  tableId: string
  rows: RowData[]
  workspaceId: string
  userId?: string
  /**
   * Optional per-row exact order keys (undo restore re-inserts at the saved key).
   * Length must equal `rows.length`.
   */
  orderKeys?: string[]
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
   * Optional partial patch to apply to the row's `tableRowExecutions`
   * entries. Top-level keys are `WorkflowGroup.id`; pass `null` for a key
   * to delete that group's execution row. Used by the cell task and cancel
   * paths.
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
  /**
   * The member who performed this write. Billed and usage-gated for any
   * enrichment the write triggers (auto-fire or dependency-cascade re-run), so
   * costs land on the editor's per-member meter rather than the workspace billed
   * account. Omitted only for internal `executionsPatch`-only writes.
   */
  actorUserId?: string | null
}

export interface BulkUpdateData {
  filter: Filter
  data: RowData
  limit?: number
  /** The member who performed this write — billed/gated for triggered enrichment. */
  actorUserId?: string | null
}

export interface BatchUpdateByIdData {
  tableId: string
  updates: Array<{
    rowId: string
    data: RowData
    executionsPatch?: Record<string, RowExecutionMetadata | null>
  }>
  workspaceId: string
  /** The member who performed this write — billed/gated for triggered enrichment. */
  actorUserId?: string | null
}

export interface BulkDeleteData {
  filter: Filter
  limit?: number
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
  /** The member adding the group — billed/gated for the auto-run enrichment pass. */
  actorUserId?: string | null
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
  /**
   * Per-column mapping swaps: keep the existing column, repoint it at a new
   * `(blockId, path)`. Applied before the `outputs` diff and clears the
   * affected columns' row data so the next run repopulates from the new
   * source.
   */
  mappingUpdates?: Array<{ columnName: string; blockId: string; path: string }>
  /** Replace the group's input mappings. Omit to leave them unchanged. */
  inputMappings?: WorkflowGroupInputMapping[]
  /** Change which workflow state the group runs against. Omit to leave unchanged. */
  deploymentMode?: WorkflowGroupDeploymentMode
  /** Update the group's provenance. Omit to leave it unchanged. */
  type?: WorkflowGroupType
  /** Toggle the group's auto-run flag. Omit to leave it unchanged. */
  autoRun?: boolean
  /** The member updating the group — billed/gated for any triggered re-run. */
  actorUserId?: string | null
}

export interface DeleteWorkflowGroupData {
  tableId: string
  groupId: string
}
