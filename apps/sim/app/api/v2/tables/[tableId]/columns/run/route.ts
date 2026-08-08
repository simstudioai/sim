import { v2RunTableColumnContract } from '@/lib/api/contracts/v2/tables'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2TableRowsErrorPolicy } from '@/lib/table/api/row-route-policies'
import { tableOperations } from '@/lib/table/application/operations'
import { startTableRun } from '@/lib/table/application/runs'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = defineV2JsonRoute({
  contract: v2RunTableColumnContract,
  operation: tableOperations.startRun,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableRowsErrorPolicy,
  mapInput: ({ params, body }) => ({
    kind: 'selection' as const,
    tableId: params.tableId,
    assertedWorkspaceId: body.workspaceId,
    groupIds: body.groupIds,
    mode: body.runMode,
    rowIds: body.rowIds,
    predicate: body.filter,
    excludeRowIds: body.excludeRowIds,
    limit: body.limit,
  }),
  useCase: startTableRun,
  present: ({ dispatchId }) => ({ data: { dispatchId } }),
})
