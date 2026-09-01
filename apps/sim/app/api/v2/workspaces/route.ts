import { v2ListWorkspacesContract } from '@/lib/api/contracts/v2/workspaces'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { listPublicWorkspaces } from '@/lib/workspaces/application/list-public-workspaces'
import { workspaceOperations } from '@/lib/workspaces/application/operations'
import { cursorSortKey, decodeOffsetCursor, encodeOffsetCursor } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const cursorScope = cursorScopeKey(cursorRoute(v2ListWorkspacesContract), {})

export const GET = defineV2JsonRoute({
  contract: v2ListWorkspacesContract,
  auth: v2ApiKeyAuth,
  operation: workspaceOperations.listPublic,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ query }) => ({
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
    limit: query.limit,
    offset: decodeOffsetCursor(
      query.cursor,
      cursorSortKey(query.sortBy, query.sortOrder),
      cursorScope
    ),
  }),
  useCase: listPublicWorkspaces,
  present: ({ workspaces, hasMore, offset, limit }, { query }) => ({
    data: workspaces.map((workspace) => ({
      ...workspace,
      createdAt: workspace.createdAt.toISOString(),
      updatedAt: workspace.updatedAt.toISOString(),
    })),
    nextCursor: hasMore
      ? encodeOffsetCursor(
          cursorSortKey(query.sortBy, query.sortOrder),
          cursorScope,
          offset + limit
        )
      : null,
  }),
})
