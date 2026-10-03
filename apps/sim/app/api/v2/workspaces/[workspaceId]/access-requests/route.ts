import {
  v2CreateWorkspaceAccessRequestContract,
  v2ListMyWorkspaceAccessRequestsContract,
} from '@/lib/api/contracts/v2/access-requests'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2AccessRequestErrorPolicy } from '@/lib/api/server/routes/access-requests'
import { readSortedCursor, writeSortedCursor } from '@/app/api/v2/lib/response'
import { accessRequestOperations } from '@/ee/access-requests/lib/application/operations'
import {
  createAccessRequest,
  listMyAccessRequests,
} from '@/ee/access-requests/lib/application/requests'

function cursorFilters(params: { workspaceId: string }, query: { status?: string }) {
  return cursorScopeKey(cursorRoute(v2ListMyWorkspaceAccessRequestsContract, params), {
    status: query.status,
  })
}

export const GET = defineV2JsonRoute({
  contract: v2ListMyWorkspaceAccessRequestsContract,
  auth: v2ApiKeyAuth,
  operation: accessRequestOperations.listMine,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2AccessRequestErrorPolicy,
  mapInput: ({ params, query }) => ({
    scope: { kind: 'workspace' as const, workspaceId: params.workspaceId },
    limit: query.limit,
    offset: 0,
    status: query.status,
    paging: {
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      cursorKeys: readSortedCursor(
        query.cursor,
        query.sortBy,
        query.sortOrder,
        cursorFilters(params, query)
      ),
    },
  }),
  useCase: listMyAccessRequests,
  present: ({ requests, nextCursorKeys }, { params, query }) => ({
    data: requests,
    nextCursor: writeSortedCursor(
      nextCursorKeys ?? null,
      query.sortBy,
      query.sortOrder,
      cursorFilters(params, query)
    ),
  }),
})

export const POST = defineV2JsonRoute({
  contract: v2CreateWorkspaceAccessRequestContract,
  auth: v2ApiKeyAuth,
  operation: accessRequestOperations.create,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2AccessRequestErrorPolicy,
  mapInput: ({ params, body }) => ({
    ...body,
    scope: { kind: 'workspace' as const, workspaceId: params.workspaceId },
  }),
  useCase: createAccessRequest,
  present: ({ request }) => ({ data: request }),
})
