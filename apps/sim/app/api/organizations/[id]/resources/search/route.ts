import { searchOrganizationResourcesContract } from '@/lib/api/contracts/resource-search'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  organizationResourceOperations,
  searchOrganizationResources,
} from '@/lib/workspaces/application/search-organization-resources'
import { readSortedCursor, writeSortedCursor } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'

/** Match position, then name: the one order this search pages in. */
const SEARCH_SORT = 'relevance'

/** Binds a cursor to the search it was minted for, so it cannot resume a different one. */
function cursorScope(
  organizationId: string,
  search: string | undefined,
  types: readonly string[] | undefined,
  workspaceIds: readonly string[] | undefined
) {
  return cursorScopeKey(cursorRoute(searchOrganizationResourcesContract, { id: organizationId }), {
    search,
    types: types ? [...types].sort().join(',') : undefined,
    workspaceIds: workspaceIds ? [...workspaceIds].sort().join(',') : undefined,
  })
}

/** GET /api/organizations/[id]/resources/search — Resources named like `q` across the viewer's workspaces. */
export const GET = defineInternalJsonRoute({
  contract: searchOrganizationResourcesContract,
  auth: internalSessionAuth,
  operation: organizationResourceOperations.search,
  rateLimit: internalRateLimits.user({ bucketName: 'organization-resource-search' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, query }) => ({
    organizationId: params.id,
    search: query.q,
    types: query.types,
    workspaceIds: query.workspaceIds,
    limit: query.limit,
    cursorKeys: readSortedCursor(
      query.cursor,
      SEARCH_SORT,
      'asc',
      cursorScope(params.id, query.q, query.types, query.workspaceIds)
    ),
  }),
  useCase: searchOrganizationResources,
  present: ({ items, nextCursorKeys }, { input }) => ({
    items,
    nextCursor: writeSortedCursor(
      nextCursorKeys,
      SEARCH_SORT,
      'asc',
      cursorScope(input.organizationId, input.search, input.types, input.workspaceIds)
    ),
  }),
})
