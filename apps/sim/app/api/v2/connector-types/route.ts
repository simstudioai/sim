import {
  type V2ListConnectorTypesQuery,
  v2ListConnectorTypesContract,
} from '@/lib/api/contracts/v2/catalog'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { listCatalogConnectorTypes } from '@/lib/catalog/application/list-connector-types'
import { catalogOperations } from '@/lib/catalog/application/operations'
import { catalogErrorPolicy } from '@/app/api/v2/lib/catalog'
import { cursorSortKey, decodeOffsetCursor, encodeOffsetCursor } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** The list has one order — the registry's — so the cursor is stamped with a fixed sort key. */
const CONNECTOR_TYPE_SORT = cursorSortKey('registry', 'asc')

/** Every param that changes which connector types, in which shape, this list returns. */
function connectorTypeCursorFilters(query: V2ListConnectorTypesQuery) {
  return cursorScopeKey(cursorRoute(v2ListConnectorTypesContract), {
    workspaceId: query.workspaceId,
    search: query.search,
    detail: query.detail,
  })
}

/**
 * GET /api/v2/connector-types — List knowledge-base connector types.
 *
 * Paged by the same offset cursor as `GET /api/v2/blocks`: the sequence is the
 * code-defined registry filtered in memory. `detail` is stamped into the cursor
 * because a page of summaries and a page of full types are different
 * sequences to a caller reading them back.
 */
export const GET = defineV2JsonRoute({
  contract: v2ListConnectorTypesContract,
  operation: catalogOperations.listConnectorTypes,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: catalogErrorPolicy,
  mapInput: ({ query }) => ({
    workspaceId: query.workspaceId,
    search: query.search,
    detail: query.detail,
    limit: query.limit,
    offset: decodeOffsetCursor(
      query.cursor,
      CONNECTOR_TYPE_SORT,
      connectorTypeCursorFilters(query)
    ),
  }),
  useCase: listCatalogConnectorTypes,
  present: ({ entries, hasMore, offset, limit }, { query }) => ({
    data: entries,
    nextCursor: hasMore
      ? encodeOffsetCursor(CONNECTOR_TYPE_SORT, connectorTypeCursorFilters(query), offset + limit)
      : null,
  }),
})
