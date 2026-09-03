import { type V2ListBlocksQuery, v2ListBlocksContract } from '@/lib/api/contracts/v2/catalog'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { listCatalogBlocks } from '@/lib/catalog/application/list-blocks'
import { catalogOperations } from '@/lib/catalog/application/operations'
import { catalogErrorPolicy } from '@/app/api/v2/lib/catalog'
import { cursorSortKey, decodeOffsetCursor, encodeOffsetCursor } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Every param that changes which blocks, in which order, this list returns. */
function blockCursorFilters(query: V2ListBlocksQuery) {
  return cursorScopeKey(cursorRoute(v2ListBlocksContract), {
    workspaceId: query.workspaceId,
    search: query.search,
    category: query.category,
    capability: query.capability,
    source: query.source,
    includeSunset: query.includeSunset,
  })
}

/** GET /api/v2/blocks — List the blocks available in a workspace. */
export const GET = defineV2JsonRoute({
  contract: v2ListBlocksContract,
  operation: catalogOperations.listBlocks,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: catalogErrorPolicy,
  /**
   * An offset cursor, matching `GET /api/v2/skills`: the sequence merges a
   * static code registry with per-workspace DB rows and re-sorts in JS, so no
   * ordered SQL read exists for a keyset predicate to act on. Every param that
   * decides which sequence that is gets stamped into the token; `limit` does
   * not, because it selects how much of the sequence to return.
   */
  mapInput: ({ query }) => ({
    ...query,
    offset: decodeOffsetCursor(
      query.cursor,
      cursorSortKey(query.sortBy, query.sortOrder),
      blockCursorFilters(query)
    ),
  }),
  useCase: listCatalogBlocks,
  present: ({ entries, hasMore, offset, limit }, { query }) => ({
    data: entries,
    nextCursor: hasMore
      ? encodeOffsetCursor(
          cursorSortKey(query.sortBy, query.sortOrder),
          blockCursorFilters(query),
          offset + limit
        )
      : null,
  }),
})
