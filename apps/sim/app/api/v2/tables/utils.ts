import type { NextResponse } from 'next/server'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import type { RowData, TableDefinition, TablePredicate, TableSchema } from '@/lib/table'
import { predicateToFilter } from '@/lib/table/query-builder/converters'
import {
  validatePredicateShape,
  validateStoragePredicate,
} from '@/lib/table/query-builder/validate'
import { predicateToStorage } from '@/lib/table/select-values'
import type { Filter } from '@/lib/table/types'
import { getWorkspaceOrganizationId } from '@/lib/workspaces/utils'
import { normalizeColumn, rootErrorMessage, rowWriteErrorResponse } from '@/app/api/table/utils'
import { v2Error } from '@/app/api/v2/lib/response'

/**
 * Shared serialization + error helpers for the v2 tables surface. Every v2
 * table/row/column route renders its payloads and access failures through these
 * so the public shape, timestamp format, and error envelope stay identical
 * across the surface. These reuse the v1 platform services and classifiers —
 * only the HTTP envelope is upgraded.
 */

/** ISO-serializes a `Date | string` timestamp from the table service layer. */
function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value)
}

/**
 * Rollout gate for the whole v2 tables surface (`tables-v2-api` flag).
 *
 * **Call this AFTER the authz check, never before.** Ahead of authz it does a
 * primary-DB read keyed on a caller-supplied `workspaceId`, and the 404-vs-403
 * split tells an unauthorized caller whether that workspace's org is in the
 * rollout cohort.
 */
export async function v2TablesGateError(
  userId: string,
  workspaceId: string
): Promise<NextResponse | null> {
  const orgId = await getWorkspaceOrganizationId(workspaceId)
  if (await isFeatureEnabled('tables-v2-api', { userId, orgId })) return null
  return v2Error('NOT_FOUND', 'Not found')
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
export function toApiTable(table: TableDefinition) {
  return {
    id: table.id,
    name: table.name,
    description: table.description,
    schema: {
      columns: (table.schema as TableSchema).columns.map(normalizeColumn),
    },
    rowCount: table.rowCount,
    maxRows: table.maxRows,
    createdAt: toIso(table.createdAt),
    updatedAt: toIso(table.updatedAt),
  }
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
 * Renders a failed {@link checkAccess} result on a MUTATION path: a missing
 * table stays 404, a missing permission stays 403. Read paths instead mask both
 * as 404 inline so cross-workspace resource existence is never leaked.
 */
export function v2TableAccessError(result: { ok: false; status: 404 | 403 }): NextResponse {
  return result.status === 404
    ? v2Error('NOT_FOUND', 'Table not found')
    : v2Error('FORBIDDEN', 'Access denied')
}

/**
 * Maps a known user-facing row-write failure (schema/size/unique/limit) to a v2
 * `BAD_REQUEST`, reusing v1's {@link rowWriteErrorResponse} classifier as the
 * single source of truth for which messages are safe to surface. Returns `null`
 * for unrecognized errors so the caller logs and returns a generic 500.
 */
export function v2RowWriteError(error: unknown): NextResponse | null {
  if (!rowWriteErrorResponse(error)) return null
  return v2Error('BAD_REQUEST', rootErrorMessage(error))
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
