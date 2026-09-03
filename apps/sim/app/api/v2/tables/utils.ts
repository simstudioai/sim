import type {
  V2ApiTable,
  V2EnrichmentProviderOutcome,
  V2EnrichmentRunDetail,
  V2RowGroupEnrichment,
  V2RowRunState,
} from '@/lib/api/contracts/v2/tables'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { workspaceResourceWebUrl } from '@/lib/resources'
import type { RowData, TableDefinition, TableRowSummary, TableSchema } from '@/lib/table'
import { getMaxRowsPerTable } from '@/lib/table/billing'
import { buildColumnNameById, remapViewConfigColumnRefs } from '@/lib/table/column-keys'
import type {
  ColumnDefinition,
  EnrichmentRunDetail,
  RowExecutionMetadata,
  RowExecutions,
  WorkflowGroup,
} from '@/lib/table/types'
import type { TableView } from '@/lib/table/views/service'
import { normalizeColumn } from '@/lib/table/wire'
import { getUserEmailsByIds, requireResolvedUserEmail } from '@/lib/users/queries'

/**
 * Shared serialization + error helpers for the v2 tables surface. Every v2
 * table/row/column route renders its payloads and access failures through these
 * so the public shape, timestamp format, and error envelope stay identical
 * across the surface. These reuse the v1 platform services and classifiers —
 * only the HTTP envelope is upgraded.
 */

/**
 * ISO-serializes a `Date | string` timestamp from the table service layer.
 *
 * Every current producer is a drizzle select over a `timestamp` column, so the
 * value arrives as a `Date`. The string branch normalizes rather than passing the
 * value through: the v2 contract promises a strict ISO-8601 instant, and a raw
 * Postgres literal (`2026-01-15 10:30:00+00`) would fail response validation.
 */
function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function requireMaxRows(
  maxRowsByWorkspaceId: ReadonlyMap<string, number>,
  workspaceId: string
): number {
  const maxRows = maxRowsByWorkspaceId.get(workspaceId)
  if (maxRows === undefined) {
    throw new Error(`Table plan limit is missing for workspace ${workspaceId}`)
  }
  return maxRows
}

/**
 * Normalized public table shape — the same subset of fields the v1 surface
 * exposes, with timestamps serialized to ISO strings. Shared by every v2 table
 * endpoint so the table payload is identical across the surface.
 */
function serializeApiTable(
  table: TableDefinition,
  folderPath: string,
  ownerEmail: string,
  maxRows: number,
  baseUrl: string
): V2ApiTable {
  return {
    id: table.id,
    webUrl: workspaceResourceWebUrl(baseUrl, table.workspaceId, 'table', table.id),
    name: table.name,
    description: table.description ?? null,
    ownerEmail,
    schema: {
      columns: (table.schema as TableSchema).columns.map(normalizeColumn),
    },
    rowCount: table.rowCount,
    maxRows,
    folderPath,
    locks: table.locks,
    // `jobStatus` is the presence signal — the service leaves the whole group
    // null when the table is idle. Without this an async import could be
    // started and cancelled but never observed to completion or failure.
    job: table.jobStatus
      ? {
          id: table.jobId ?? null,
          type: table.jobType ?? null,
          status: table.jobStatus,
          rowsProcessed: table.jobRowsProcessed ?? 0,
          error: table.jobError ?? null,
        }
      : null,
    createdAt: toIso(table.createdAt),
    updatedAt: toIso(table.updatedAt),
  }
}

/** Resolves and serializes one table with public owner attribution. */
export async function toApiTable(table: TableDefinition, folderPath: string): Promise<V2ApiTable> {
  const [emailByUserId, maxRows] = await Promise.all([
    getUserEmailsByIds([table.createdBy]),
    getMaxRowsPerTable(table.workspaceId),
  ])
  return serializeApiTable(
    table,
    folderPath,
    requireResolvedUserEmail(emailByUserId, table.createdBy),
    maxRows,
    getBaseUrl()
  )
}

/** Batch-resolves owner emails before serializing a table list. */
export async function toApiTables(
  entries: readonly { table: TableDefinition; folderPath: string }[]
): Promise<V2ApiTable[]> {
  const workspaceIds = [...new Set(entries.map(({ table }) => table.workspaceId))]
  const [emailByUserId, limits] = await Promise.all([
    getUserEmailsByIds(entries.map(({ table }) => table.createdBy)),
    Promise.all(
      workspaceIds.map(
        async (workspaceId) => [workspaceId, await getMaxRowsPerTable(workspaceId)] as const
      )
    ),
  ])
  const maxRowsByWorkspaceId = new Map(limits)
  const baseUrl = getBaseUrl()
  return entries.map(({ table, folderPath }) =>
    serializeApiTable(
      table,
      folderPath,
      requireResolvedUserEmail(emailByUserId, table.createdBy),
      requireMaxRows(maxRowsByWorkspaceId, table.workspaceId),
      baseUrl
    )
  )
}

/**
 * Normalized public view shape: ISO timestamps, and a `config` whose column
 * references are presented as column **names**.
 *
 * A view stores every column reference as a stable id so a rename cannot orphan
 * it — but the v2 surface is name-keyed everywhere else (row `data`, query
 * predicates, sort fields, and workflow groups via `presentV2WorkflowGroup`),
 * and a caller who never sees a `col_…` id cannot round-trip a config it reads
 * back into a create. The write path translates in the other direction, so the
 * pair is symmetric. A ref naming no current column (a since-deleted column in
 * a saved filter) is left as-is.
 */
export function toApiView(
  view: TableView,
  createdByEmail: string | null,
  columns: ColumnDefinition[]
) {
  return {
    id: view.id,
    tableId: view.tableId,
    name: view.name,
    config: remapViewConfigColumnRefs(view.config, buildColumnNameById(columns)),
    isDefault: view.isDefault,
    createdByEmail,
    createdAt: toIso(view.createdAt),
    updatedAt: toIso(view.updatedAt),
  }
}

/**
 * Maps a stored column id (the JSONB key that `findRowMatches` reports) back to
 * its display name, so cell references on the public wire are name-keyed like
 * row `data`. Falls back to the id for a column that no longer exists.
 */
export function columnNameById(schema: TableSchema): (columnId: string) => string {
  const nameById = buildColumnNameById(schema.columns)
  return (columnId) => nameById.get(columnId) ?? columnId
}

/**
 * Row fields the public API exposes. `data` is stored id-keyed; {@link toApiRow}
 * translates it to column names.
 */
interface ApiRowInput {
  id: string
  data: RowData
  createdAt: Date | string
  updatedAt: Date | string
}

/**
 * Projects the stored per-`(row, group)` execution sidecar onto the public
 * `runState` map.
 *
 * `jobId` is dropped — it is the async scheduler's own identity and addresses
 * nothing a caller can reach — and so is `enrichmentDetails`, which is never
 * hydrated on this path and has its own sub-resource. The two optional storage
 * fields are defaulted so the published schema can declare them required, which
 * is what lets a client read `blockErrors` without a presence check.
 */
function toApiRunState(executions: RowExecutions): Record<string, V2RowRunState> {
  const runState: Record<string, V2RowRunState> = {}
  for (const [groupId, execution] of Object.entries(executions)) {
    runState[groupId] = toApiRunStateEntry(execution)
  }
  return runState
}

/** One group's run state on one row, in the published shape. */
function toApiRunStateEntry(execution: RowExecutionMetadata): V2RowRunState {
  return {
    /** Stored as `cancelled`; published as `canceled`. See presentV2TableDispatch. */
    status: execution.status === 'cancelled' ? 'canceled' : execution.status,
    executionId: execution.executionId,
    workflowId: execution.workflowId,
    error: execution.error,
    runningBlockIds: execution.runningBlockIds ?? [],
    blockErrors: execution.blockErrors ?? {},
    canceledAt: execution.cancelledAt ?? null,
  }
}

/** The inputs to {@link toApiRowGroupEnrichment}, as the use case returns them. */
export interface RowGroupEnrichmentInput {
  row: TableRowSummary
  group: WorkflowGroup
  runState: RowExecutionMetadata | null
  detail: EnrichmentRunDetail | null
}

/**
 * One group's outcome on one row: the run state `includeRunState` publishes,
 * the group's output cells read out of the row, and the provider cascade.
 *
 * `outputs` is keyed by column NAME through the same `namedRowMapper` the row
 * reads use, and every output column the group declares is present — `null`
 * when the run has not written it — so a caller can tell "not populated" from
 * "not an output of this group". `runState: null` is the group never having
 * run for this row; the row itself always answers.
 */
export function toApiRowGroupEnrichment(
  input: RowGroupEnrichmentInput,
  toNamedRow: (data: RowData) => RowData
): V2RowGroupEnrichment {
  const named = toNamedRow(input.row.data)
  const outputs: RowData = {}
  for (const output of input.group.outputs) {
    outputs[output.columnName] = named[output.columnName] ?? null
  }
  return {
    groupId: input.group.id,
    runState: input.runState ? toApiRunStateEntry(input.runState) : null,
    outputs,
    cascade: toApiEnrichmentDetail(input.detail),
  }
}

/**
 * Normalized public row shape: `{ id, data, createdAt, updatedAt }`, plus
 * `runState` when — and only when — the caller opted in.
 *
 * Storage internals stay off the wire: `position` and `orderKey` are a
 * fractional index that is nullable mid-backfill and that a caller cannot mint.
 * The per-cell execution sidecar is NOT one of them — it holds run outcomes of
 * runs this same API starts, which is why it is reachable through
 * `includeRunState` rather than stripped. Do not "restore" the strip.
 *
 * Callers pass a `namedRowMapper(schema.columns)` so `data` is keyed by column
 * NAME and select cells surface their option NAME rather than the stored option
 * id.
 */
export function toApiRow(
  row: ApiRowInput,
  toNamedRow: (data: RowData) => RowData,
  runState?: RowExecutions
) {
  return {
    id: row.id,
    data: toNamedRow(row.data),
    ...(runState ? { runState: toApiRunState(runState) } : {}),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  }
}

/** Reads a stored field that the published shape declares as a plain number. */
function storedNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** Reads a stored field that the published shape declares as a nullable string. */
function storedNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/**
 * Reads a stored timestamp, keeping only a value the published `date-time`
 * format will accept. A Postgres literal or a half-written blob becomes `null`
 * rather than failing response validation.
 */
function storedTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString()
}

function toApiEnrichmentProvider(value: unknown): V2EnrichmentProviderOutcome {
  const provider = (value ?? {}) as Record<string, unknown>
  return {
    id: storedNullableString(provider.id) ?? '',
    label: storedNullableString(provider.label) ?? '',
    toolId: storedNullableString(provider.toolId) ?? '',
    status: storedNullableString(provider.status) ?? 'not_run',
    cost: storedNumber(provider.cost),
    durationMs: storedNumber(provider.durationMs),
    error: storedNullableString(provider.error),
  }
}

/**
 * Projects the stored enrichment cascade blob onto the published detail shape.
 *
 * `tableRowExecutions.enrichmentDetails` is schemaless JSONB read back through
 * a bare `as` cast, so the domain type is the writer's intent, not a property of
 * the column. Every declared key is projected with a default here so a blob
 * written by an older runner — or one whose shape drifts — degrades to a partial
 * answer instead of turning a well-formed `GET` into a `500` at response
 * validation.
 */
export function toApiEnrichmentDetail(
  detail: EnrichmentRunDetail | null
): V2EnrichmentRunDetail | null {
  if (!detail || typeof detail !== 'object') return null
  const stored: Record<string, unknown> = { ...detail }
  return {
    startedAt: storedTimestamp(stored.startedAt),
    completedAt: storedTimestamp(stored.completedAt),
    durationMs: storedNumber(stored.durationMs),
    totalCost: storedNumber(stored.totalCost),
    matchedProvider: storedNullableString(stored.matchedProvider),
    aborted: stored.aborted === true,
    providers: Array.isArray(stored.providers) ? stored.providers.map(toApiEnrichmentProvider) : [],
  }
}
