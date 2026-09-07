import { rowQueryContract, TABLE_QUERY_MAX_BODY_BYTES } from '@/lib/api/contracts/tables'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  resolveInternalAuthWorkspaceId,
} from '@/lib/api/server/routes'
import { internalTableSessionOrExecutorAuth } from '@/lib/table/api'
import { internalTableV2QueryErrorPolicy } from '@/lib/table/api/row-route-policies'
import { tableOperations } from '@/lib/table/application/operations'
import { queryTableRows } from '@/lib/table/application/rows'
import {
  finalizeTableRowsProvenance,
  negotiateTableRowsProvenance,
} from '@/app/api/table/row-secret-provenance'
import { presentQueryRowForKeying, rowKeyingForAuthTransport } from '@/app/api/table/row-wire'

export const POST = defineInternalJsonRoute({
  contract: rowQueryContract,
  operation: tableOperations.queryRows,
  auth: internalTableSessionOrExecutorAuth,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal v2 table query behavior',
  }),
  errorPolicy: internalTableV2QueryErrorPolicy,
  parseOptions: { maxBodyBytes: TABLE_QUERY_MAX_BODY_BYTES },
  mapInput: ({ params, body }, { request, authTransport, executionWorkspaceId }) => ({
    tableId: params.tableId,
    assertedWorkspaceId: resolveInternalAuthWorkspaceId(
      authTransport,
      executionWorkspaceId,
      body.workspaceId
    ),
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
      authTransport === 'executor_jwt'
    ),
  }),
  useCase: queryTableRows,
  present: (result, { authTransport }) => ({
    success: true as const,
    data: {
      rows: result.rows.map((row) =>
        presentQueryRowForKeying(row, result.table.schema, rowKeyingForAuthTransport(authTransport))
      ),
      rowCount: result.rowCount,
      totalCount: result.totalCount,
      limit: result.limit,
      nextCursor: result.nextCursor,
    },
  }),
  finalizeResponse: ({ result }) => finalizeTableRowsProvenance(result.secretProvenance),
})
