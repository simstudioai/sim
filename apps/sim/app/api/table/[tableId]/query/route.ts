import { rowQueryContract, TABLE_QUERY_MAX_BODY_BYTES } from '@/lib/api/contracts/tables'
import { defineInternalJsonRoute, internalRateLimits } from '@/lib/api/server/routes'
import { internalTableSessionOrExecutorAuth } from '@/lib/table/api'
import { internalTableV2QueryErrorPolicy } from '@/lib/table/api/row-route-policies'
import { tableOperations } from '@/lib/table/application/operations'
import { queryTableRows } from '@/lib/table/application/rows'
import {
  finalizeTableRowsProvenance,
  negotiateTableRowsProvenance,
} from '@/app/api/table/row-secret-provenance'
import { presentQueryRowForPrincipal } from '@/app/api/table/row-wire'

export const POST = defineInternalJsonRoute({
  contract: rowQueryContract,
  operation: tableOperations.queryRows,
  auth: internalTableSessionOrExecutorAuth,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal v2 table query behavior',
  }),
  errorPolicy: internalTableV2QueryErrorPolicy,
  parseOptions: { maxBodyBytes: TABLE_QUERY_MAX_BODY_BYTES },
  mapInput: ({ params, body }, { principal, request }) => ({
    tableId: params.tableId,
    assertedWorkspaceId: principal.kind === 'delegated' ? principal.workspaceId : body.workspaceId,
    predicate: body.predicate,
    sort: body.sort,
    columns: body.columns,
    limit: body.limit,
    cursor: body.cursor,
    includeTotal: !body.cursor,
    includeRunState: false,
    allowExpandedLimit: true,
    requireV2Feature: true,
    includePersistedSecretProvenance: negotiateTableRowsProvenance(
      request,
      principal.kind === 'delegated'
    ),
  }),
  useCase: queryTableRows,
  present: (result, { principal }) => ({
    success: true as const,
    data: {
      rows: result.rows.map((row) =>
        presentQueryRowForPrincipal(row, result.table.schema, principal)
      ),
      rowCount: result.rowCount,
      totalCount: result.totalCount,
      limit: result.limit,
      nextCursor: result.nextCursor,
    },
  }),
  finalizeResponse: ({ result }) => finalizeTableRowsProvenance(result.secretProvenance),
})
