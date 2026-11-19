import {
  v2CreateSearchSourceContract,
  v2ListSearchSourcesContract,
} from '@/lib/api/contracts/v2/search-sources'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2OrganizationErrorPolicy } from '@/lib/api/server/routes/organizations'
import { toV2SearchSource } from '@/lib/knowledge/api/search-source-presenter'
import {
  createManagedSearchSource,
  listManagedSearchSources,
} from '@/lib/knowledge/application/manage-search-sources'
import { searchSourceOperations } from '@/lib/knowledge/application/operations'
import { cursorSortKey, decodeOffsetCursor, encodeOffsetCursor } from '@/app/api/v2/lib/response'

const cursorScope = (organizationId: string) =>
  cursorScopeKey(cursorRoute(v2ListSearchSourcesContract, { organizationId }), {})

export const GET = defineV2JsonRoute({
  contract: v2ListSearchSourcesContract,
  operation: searchSourceOperations.list,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrganizationErrorPolicy,
  mapInput: ({ params, query }) => ({
    ...params,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
    limit: query.limit,
    offset: decodeOffsetCursor(
      query.cursor,
      cursorSortKey(query.sortBy, query.sortOrder),
      cursorScope(params.organizationId)
    ),
  }),
  useCase: listManagedSearchSources,
  present: ({ connectors, hasMore, offset, limit }, { params, query }) => ({
    data: connectors.map(toV2SearchSource),
    nextCursor: hasMore
      ? encodeOffsetCursor(
          cursorSortKey(query.sortBy, query.sortOrder),
          cursorScope(params.organizationId),
          offset + limit
        )
      : null,
  }),
})

export const POST = defineV2JsonRoute({
  contract: v2CreateSearchSourceContract,
  operation: searchSourceOperations.create,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrganizationErrorPolicy,
  mapInput: ({ params, body }) => ({ ...params, ...body }),
  useCase: createManagedSearchSource,
  present: ({ connector }) => ({ data: toV2SearchSource(connector) }),
})
