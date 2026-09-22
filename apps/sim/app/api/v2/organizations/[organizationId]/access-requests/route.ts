import {
  v2CreateOrganizationAccessRequestContract,
  v2ListOrganizationAccessRequestsContract,
} from '@/lib/api/contracts/v2/access-requests'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2AccessRequestErrorPolicy } from '@/lib/api/server/routes/access-requests'
import { readSortedCursor, writeSortedCursor } from '@/app/api/v2/lib/response'
import { accessRequestOperations } from '@/ee/access-requests/lib/application/operations'
import {
  createAccessRequest,
  listOrganizationAccessRequests,
} from '@/ee/access-requests/lib/application/requests'

function cursorFilters(
  params: { organizationId: string },
  query: { search?: string; status?: string }
) {
  return cursorScopeKey(cursorRoute(v2ListOrganizationAccessRequestsContract, params), {
    search: query.search,
    status: query.status,
  })
}

export const POST = defineV2JsonRoute({
  contract: v2CreateOrganizationAccessRequestContract,
  auth: v2ApiKeyAuth,
  operation: accessRequestOperations.create,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2AccessRequestErrorPolicy,
  mapInput: ({ params, body }) => ({
    ...body,
    scope: { kind: 'organization' as const, organizationId: params.organizationId },
  }),
  useCase: createAccessRequest,
  present: ({ request }) => ({ data: request }),
})

export const GET = defineV2JsonRoute({
  contract: v2ListOrganizationAccessRequestsContract,
  auth: v2ApiKeyAuth,
  operation: accessRequestOperations.listOrganization,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2AccessRequestErrorPolicy,
  mapInput: ({ params, query }) => ({
    ...params,
    limit: query.limit,
    offset: 0,
    search: query.search,
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
  useCase: listOrganizationAccessRequests,
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
