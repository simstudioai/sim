import {
  v2GetRowEnrichmentContract,
  v2RunRowEnrichmentContract,
} from '@/lib/api/contracts/v2/tables'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2TableRowsErrorPolicy } from '@/lib/table/api/row-route-policies'
import { tableOperations } from '@/lib/table/application/operations'
import { readTableRowEnrichmentDetail } from '@/lib/table/application/rows'
import { startTableRun } from '@/lib/table/application/runs'
import { namedRowMapper } from '@/lib/table/cell-format'
import { toApiRowGroupEnrichment } from '@/app/api/v2/tables/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * One group's outcome on one row: the run state `includeRunState` reports, the
 * output cells that run populated, and — for an enrichment group — the provider
 * cascade behind them: which providers ran, what each cost and took, and which
 * produced the match.
 *
 * Deliberately its own read rather than a field on the row: the breakdown can
 * carry a dozen provider outcomes per cell, which is why the storage layer
 * keeps it off the grid read and why `includeRunState` on the row surfaces
 * reports the cell's status without it. A row that exists always answers with
 * the full shape — `{"data": null}` for a populated row told a caller nothing.
 *
 * A pure read, so the default `headSafe` stands. The `POST` on this same path
 * starts a run — if a future `GET` here ever acquires a side effect, that flag
 * must flip with it.
 */
export const GET = defineV2JsonRoute({
  contract: v2GetRowEnrichmentContract,
  operation: tableOperations.readRow,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableRowsErrorPolicy,
  mapInput: ({ params, query }) => ({
    tableId: params.tableId,
    rowId: params.rowId,
    groupId: params.groupId,
    assertedWorkspaceId: query.workspaceId,
  }),
  useCase: readTableRowEnrichmentDetail,
  present: ({ table, row, group, runState, detail }) => ({
    data: toApiRowGroupEnrichment(
      { row, group, runState, detail },
      namedRowMapper(table.schema.columns)
    ),
  }),
})

export const POST = defineV2JsonRoute({
  contract: v2RunRowEnrichmentContract,
  operation: tableOperations.startRun,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableRowsErrorPolicy,
  mapInput: ({ params, body }) => ({
    kind: 'row_enrichment' as const,
    tableId: params.tableId,
    rowId: params.rowId,
    groupId: params.groupId,
    assertedWorkspaceId: body.workspaceId,
  }),
  useCase: startTableRun,
  present: ({ dispatchId }) => ({ data: { dispatchId } }),
})
