import { type V2ListToolsQuery, v2ListToolsContract } from '@/lib/api/contracts/v2/catalog'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { listCatalogTools } from '@/lib/catalog/application/list-tools'
import { catalogOperations } from '@/lib/catalog/application/operations'
import { catalogErrorPolicy } from '@/app/api/v2/lib/catalog'
import { cursorSortKey, decodeOffsetCursor, encodeOffsetCursor } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Every param that changes which tools, in which order, this list returns. */
function toolCursorFilters(query: V2ListToolsQuery) {
  return cursorScopeKey(cursorRoute(v2ListToolsContract), {
    workspaceId: query.workspaceId,
    search: query.search,
    hostedApiKey: query.hostedApiKey,
    oauthProvider: query.oauthProvider,
  })
}

/** GET /api/v2/tools — List the built-in tools available in a workspace. */
export const GET = defineV2JsonRoute({
  contract: v2ListToolsContract,
  operation: catalogOperations.listTools,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: catalogErrorPolicy,
  /** An offset cursor for the same reason as `GET /api/v2/blocks`. */
  mapInput: ({ query }) => ({
    ...query,
    offset: decodeOffsetCursor(
      query.cursor,
      cursorSortKey(query.sortBy, query.sortOrder),
      toolCursorFilters(query)
    ),
  }),
  useCase: listCatalogTools,
  present: ({ entries, hasMore, offset, limit }, { query }) => ({
    data: entries,
    nextCursor: hasMore
      ? encodeOffsetCursor(
          cursorSortKey(query.sortBy, query.sortOrder),
          toolCursorFilters(query),
          offset + limit
        )
      : null,
  }),
})
