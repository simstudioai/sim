import type { NextResponse } from 'next/server'
import type { V2ApiTable } from '@/lib/api/contracts/v2/tables'
import type { OrchestrationErrorCode } from '@/lib/core/orchestration/types'
import type { MultipartError } from '@/lib/core/utils/multipart'
import type { RowData, TableDefinition, TablePredicate, TableSchema } from '@/lib/table'
import { getMaxRowsPerTable } from '@/lib/table/billing'
import { getColumnId } from '@/lib/table/column-keys'
import { TableLockedError } from '@/lib/table/mutation-locks'
import { predicateToFilter } from '@/lib/table/query-builder/converters'
import {
  validatePredicateShape,
  validateStoragePredicate,
} from '@/lib/table/query-builder/validate'
import { predicateToStorage } from '@/lib/table/select-values'
import type { Filter, TableLockKind } from '@/lib/table/types'
import type { TableView } from '@/lib/table/views/service'
import { getUserEmailsByIds, requireResolvedUserEmail } from '@/lib/users/queries'
import { CSV_IMPORT_PROXY_BODY_CAP_BYTES, normalizeColumn } from '@/app/api/table/utils'
import { v2Error, v2ErrorForOrchestration } from '@/app/api/v2/lib/response'

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
 * Resolves a public v2 bulk-op predicate to the storage-id-keyed legacy `Filter`
 * the row runners consume. The public wire is column-NAME-keyed: shape-check
 * first (keying-agnostic), translate names → storage ids (including select
 * operand names → option ids), then validate the RESULT against storage keys —
 * on a destructive path an unresolved field must 400, not silently match
 * nothing.
 */
export function v2BulkPredicateToFilter(predicate: TablePredicate, schema: TableSchema): Filter {
  validatePredicateShape(predicate)
  const translated = predicateToStorage(predicate, schema)
  validateStoragePredicate(translated, schema.columns)
  return predicateToFilter(translated)
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
  maxRows: number
): V2ApiTable {
  return {
    id: table.id,
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
    maxRows
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
  return entries.map(({ table, folderPath }) =>
    serializeApiTable(
      table,
      folderPath,
      requireResolvedUserEmail(emailByUserId, table.createdBy),
      requireMaxRows(maxRowsByWorkspaceId, table.workspaceId)
    )
  )
}

/**
 * Normalized public view shape. Identical to the stored view except that the
 * timestamps are ISO strings, matching every other v2 payload.
 */
export function toApiView(view: TableView, createdByEmail: string | null) {
  return {
    id: view.id,
    tableId: view.tableId,
    name: view.name,
    config: view.config,
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
  const nameById = new Map(schema.columns.map((column) => [getColumnId(column), column.name]))
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
 * Normalized public row shape: `{ id, data, createdAt, updatedAt }`, no storage
 * internals (`position`/`orderKey`/`executions`). Callers pass a
 * `namedRowMapper(schema.columns)` so `data` is keyed by column NAME and select
 * cells surface their option NAME rather than the stored option id.
 */
export function toApiRow(row: ApiRowInput, toNamedRow: (data: RowData) => RowData) {
  return {
    id: row.id,
    data: toNamedRow(row.data),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  }
}

/**
 * Maps a {@link MultipartError} from the streaming CSV reader to the v2
 * envelope. Mirrors v1's {@link multipartErrorResponse} — same classification,
 * different envelope.
 */
export function v2MultipartError(error: MultipartError): NextResponse {
  if (error.code === 'FILE_TOO_LARGE') {
    return v2Error('PAYLOAD_TOO_LARGE', 'CSV import file exceeds maximum size')
  }
  return error.code === 'NO_FILE'
    ? v2Error('BAD_REQUEST', 'CSV file is required')
    : v2Error('BAD_REQUEST', `Invalid CSV upload: ${error.message}`)
}

/**
 * 413 when a synchronous CSV upload would exceed the proxy's body cap; `null`
 * otherwise. Next buffers the request body for the proxy and silently
 * TRUNCATES it past the cap, so an unchecked oversize upload imports a partial
 * file and reports success — the failure this exists to prevent.
 */
export function v2CsvBodyCapError(request: { headers: Headers }): NextResponse | null {
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength <= CSV_IMPORT_PROXY_BODY_CAP_BYTES) return null
  return v2Error(
    'PAYLOAD_TOO_LARGE',
    'File too large to import through the server. Upload it to workspace storage and use the async import instead.'
  )
}

/**
 * Maps a delete/write rejected by a table lock to the v2 `LOCKED` envelope,
 * mirroring v1's {@link tableLockErrorResponse}. Returns `null` for anything
 * else so the caller falls through to its own classification.
 *
 * `details.lock` names the flag that rejected the write. A table carries four
 * independent locks, so "locked" on its own does not tell a caller which one to
 * clear — every 423 on the surface reports it.
 */
export function v2TableLockError(
  error: unknown,
  /** Merged into `details` — e.g. which operations of a composite write landed. */
  extraDetails?: Record<string, unknown>
): NextResponse | null {
  if (error instanceof TableLockedError) {
    return v2Error('LOCKED', error.message, { details: { lock: error.lock, ...extraDetails } })
  }
  return null
}

/** The failure half of any `lib/table/orchestration` result. */
export interface OrchestrationOutcome {
  errorCode?: OrchestrationErrorCode
  error?: string
  lock?: TableLockKind
}

/**
 * Renders a `lib/table/orchestration` failure in the v2 envelope, naming the
 * lock when one caused it.
 *
 * A lock rejection reaches a route two different ways — thrown and caught at
 * the boundary ({@link v2TableLockError}), or returned as a classified
 * `errorCode: 'locked'` outcome — and both must produce the same body. Plain
 * {@link v2ErrorForOrchestration} cannot, because the `lock` kind lives on the
 * outcome rather than the code, so every table route that renders an
 * orchestration result goes through this instead.
 */
export function v2TableOrchestrationError(
  outcome: OrchestrationOutcome,
  fallback: string,
  /** Merged into `details` — e.g. which operations of a composite write landed. */
  extraDetails?: Record<string, unknown>
): NextResponse {
  // `lock` is omitted rather than sent as null when the kind is unknown — a
  // caller branching on `details.lock` should see absence, not a phantom value.
  const details = {
    ...(outcome.errorCode === 'locked' && outcome.lock ? { lock: outcome.lock } : {}),
    ...extraDetails,
  }
  return v2ErrorForOrchestration(
    outcome.errorCode,
    outcome.error ?? fallback,
    Object.keys(details).length > 0 ? details : undefined
  )
}

/**
 * Adapts a failed-row validation from the shared `validateRowData` /
 * `validateBatchRows` helpers — which bake a v1-shaped `{ error, details }` 400
 * response — into the canonical v2 error envelope while preserving the
 * structured `details` (per-field / per-row). The validators expose the failure
 * only as a rendered response, so the body is read back rather than
 * re-implementing the size/schema/unique checks.
 */
export async function v2RowValidationError(response: NextResponse): Promise<NextResponse> {
  const body = (await response
    .clone()
    .json()
    .catch(() => ({}))) as { error?: string; details?: unknown }
  return v2Error('BAD_REQUEST', body.error ?? 'Invalid row data', { details: body.details })
}
