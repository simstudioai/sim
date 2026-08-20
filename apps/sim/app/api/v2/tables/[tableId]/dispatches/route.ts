import { v2ListTableDispatchesContract } from '@/lib/api/contracts/v2/tables'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2TableErrorPolicies } from '@/lib/table/api'
import { tableOperations } from '@/lib/table/application/operations'
import { listTableDispatches } from '@/lib/table/application/runs'
import { presentV2TableDispatch } from '@/app/api/v2/tables/presenters'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Every dispatch still in flight on one table. Unpaged: the dispatcher bounds
 * how many dispatches a table can have active, so `nextCursor` is always null
 * and there is no page for a `limit` to select.
 */
export const GET = defineV2JsonRoute({
  contract: v2ListTableDispatchesContract,
  operation: tableOperations.readRun,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableErrorPolicies.concealTableAuthorization,
  mapInput: ({ params, query }) => ({
    tableId: params.tableId,
    assertedWorkspaceId: query.workspaceId,
  }),
  useCase: listTableDispatches,
  present: ({ dispatches }) => ({
    data: dispatches.map(presentV2TableDispatch),
    nextCursor: null,
  }),
})
