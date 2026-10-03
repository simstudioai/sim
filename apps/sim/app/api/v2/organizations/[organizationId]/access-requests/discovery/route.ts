import { v2DiscoverOrganizationAccessRequestsContract } from '@/lib/api/contracts/v2/access-requests'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2AccessRequestErrorPolicy } from '@/lib/api/server/routes/access-requests'
import { cursorSortKey, decodeOffsetCursor, encodeOffsetCursor } from '@/app/api/v2/lib/response'
import { accessRequestOperations } from '@/ee/access-requests/lib/application/operations'
import { discoverAccessRequests } from '@/ee/access-requests/lib/application/requests'

function cursorFilters(
  params: { organizationId: string },
  query: { search?: string; targetKind?: string; state?: string }
) {
  return cursorScopeKey(cursorRoute(v2DiscoverOrganizationAccessRequestsContract, params), {
    search: query.search,
    targetKind: query.targetKind,
    state: query.state,
  })
}

export const GET = defineV2JsonRoute({
  contract: v2DiscoverOrganizationAccessRequestsContract,
  auth: v2ApiKeyAuth,
  operation: accessRequestOperations.discover,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2AccessRequestErrorPolicy,
  mapInput: ({ params, query }) => ({
    ...query,
    kind: 'organization' as const,
    organizationId: params.organizationId,
    offset: decodeOffsetCursor(
      query.cursor,
      cursorSortKey(query.sortBy, query.sortOrder),
      cursorFilters(params, query)
    ),
  }),
  useCase: discoverAccessRequests,
  present: ({ entries, hasMore }, { params, query }) => ({
    data: entries,
    nextCursor: hasMore
      ? encodeOffsetCursor(
          cursorSortKey(query.sortBy, query.sortOrder),
          cursorFilters(params, query),
          decodeOffsetCursor(
            query.cursor,
            cursorSortKey(query.sortBy, query.sortOrder),
            cursorFilters(params, query)
          ) + entries.length
        )
      : null,
  }),
})
