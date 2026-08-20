import { v2GetTableDispatchContract } from '@/lib/api/contracts/v2/tables'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2TableErrorPolicies } from '@/lib/table/api'
import { tableOperations } from '@/lib/table/application/operations'
import { readTableDispatch } from '@/lib/table/application/runs'
import { presentV2TableDispatch } from '@/app/api/v2/tables/presenters'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Polls the dispatch `POST /tables/{tableId}/columns/run` returned an id for.
 * Answers in every lifecycle state, terminal ones included — a poller that
 * cannot read the state it is waiting for would never stop.
 */
export const GET = defineV2JsonRoute({
  contract: v2GetTableDispatchContract,
  operation: tableOperations.readRun,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableErrorPolicies.concealDispatchAuthorization,
  mapInput: ({ params, query }) => ({
    dispatchId: params.dispatchId,
    workspaceId: query.workspaceId,
  }),
  useCase: readTableDispatch,
  present: ({ dispatch }) => ({ data: presentV2TableDispatch(dispatch) }),
})
