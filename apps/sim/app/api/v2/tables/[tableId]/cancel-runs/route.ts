import { createLogger } from '@sim/logger'
import { v2CancelTableRunsContract } from '@/lib/api/contracts/v2/tables'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2TableRowsErrorPolicy } from '@/lib/table/api/row-route-policies'
import { tableOperations } from '@/lib/table/application/operations'
import { cancelTableRuns } from '@/lib/table/application/runs'

const logger = createLogger('V2TableCancelRunsAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = defineV2JsonRoute({
  contract: v2CancelTableRunsContract,
  operation: tableOperations.cancelRuns,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableRowsErrorPolicy,
  mapInput: ({ params, body }) =>
    body.scope === 'row'
      ? {
          scope: 'row' as const,
          tableId: params.tableId,
          assertedWorkspaceId: body.workspaceId,
          rowId: body.rowId!,
        }
      : {
          scope: 'all' as const,
          tableId: params.tableId,
          assertedWorkspaceId: body.workspaceId,
          predicate: body.filter,
          excludeRowIds: body.excludeRowIds,
        },
  useCase: cancelTableRuns,
  present: ({ table, cancelled }) => {
    logger.info('Cancelled table runs', { tableId: table.id, cancelled })
    return { data: { cancelled } }
  },
})
