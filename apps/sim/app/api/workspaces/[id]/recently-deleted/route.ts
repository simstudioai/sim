import { listRecentlyDeletedContract } from '@/lib/api/contracts/recently-deleted'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  listRecentlyDeleted,
  recentlyDeletedOperations,
} from '@/lib/workspaces/application/list-recently-deleted'
import { readSortedCursor, writeSortedCursor } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'

function cursorScope(id: string, type: string, search: string | undefined) {
  return cursorScopeKey(cursorRoute(listRecentlyDeletedContract, { id }), { type, search })
}

/** GET /api/workspaces/[id]/recently-deleted — One page of the workspace's Recently Deleted view. */
export const GET = defineInternalJsonRoute({
  contract: listRecentlyDeletedContract,
  auth: internalSessionAuth,
  operation: recentlyDeletedOperations.list,
  rateLimit: internalRateLimits.none({
    reason: 'Replaces the per-type archived lists, which carry no rate limit',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, query }) => ({
    workspaceId: params.id,
    filter: query.type,
    search: query.search,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
    limit: query.limit,
    cursorKeys: readSortedCursor(
      query.cursor,
      query.sortBy,
      query.sortOrder,
      cursorScope(params.id, query.type, query.search)
    ),
  }),
  useCase: listRecentlyDeleted,
  present: ({ items, nextCursorKeys }, { input }) => ({
    items,
    nextCursor: writeSortedCursor(
      nextCursorKeys,
      input.sortBy,
      input.sortOrder,
      cursorScope(input.workspaceId, input.filter, input.search)
    ),
  }),
})
