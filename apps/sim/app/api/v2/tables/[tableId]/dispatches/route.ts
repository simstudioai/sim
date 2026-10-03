import {
  v2CreateTableDispatchContract,
  v2ListTableDispatchesContract,
} from '@/lib/api/contracts/v2/tables'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2TableErrorPolicies } from '@/lib/table/api'
import { v2TableRowsErrorPolicy } from '@/lib/table/api/row-route-policies'
import { tableOperations } from '@/lib/table/application/operations'
import { listTableDispatches, startTableRun } from '@/lib/table/application/runs'
import { presentV2TableDispatch } from '@/app/api/v2/tables/presenters'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * The dispatches on one table, most recent first, settled ones included — a
 * run that finished between two polls is still listed next to the id its
 * create returned. Unpaged: the use case caps the list at the most recent
 * hundred, so `nextCursor` is always null and there is no page for a `limit`
 * to select.
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

/**
 * Starts a run and returns the `dispatchId` naming it, so create, list, get, and cancel are
 * one resource on one path. A `null` `dispatchId` means the run settled inline and there is
 * nothing to poll.
 */
export const POST = defineV2JsonRoute({
  contract: v2CreateTableDispatchContract,
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
