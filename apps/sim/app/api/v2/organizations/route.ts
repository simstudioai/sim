import { v2ListOrganizationsContract } from '@/lib/api/contracts/v2/organizations'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import { presentOrganization } from '@/lib/api/server/organization-presenters'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2OrganizationErrorPolicy } from '@/lib/api/server/routes/organizations'
import { organizationOperations } from '@/lib/organizations/application/operations'
import { listOrganizations } from '@/lib/organizations/application/reads'
import { readSortedCursor, writeSortedCursor } from '@/app/api/v2/lib/response'

export const GET = defineV2JsonRoute({
  contract: v2ListOrganizationsContract,
  operation: organizationOperations.list,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrganizationErrorPolicy,
  mapInput: ({ query }) => ({
    ...query,
    cursorKeys: readSortedCursor(
      query.cursor,
      query.sortBy,
      query.sortOrder,
      cursorScopeKey(cursorRoute(v2ListOrganizationsContract, {}), { search: query.search })
    ),
  }),
  useCase: listOrganizations,
  present: ({ data, nextCursorKeys }, { query }) => ({
    data: data.map(presentOrganization),
    nextCursor: writeSortedCursor(
      nextCursorKeys,
      query.sortBy,
      query.sortOrder,
      cursorScopeKey(cursorRoute(v2ListOrganizationsContract, {}), { search: query.search })
    ),
  }),
})
