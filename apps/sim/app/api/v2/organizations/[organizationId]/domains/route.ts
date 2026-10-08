import {
  v2AddOrganizationDomainContract,
  v2ListOrganizationDomainsContract,
} from '@/lib/api/contracts/v2/sso'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2SsoErrorPolicy } from '@/lib/api/server/routes/sso'
import { toDomainResponse } from '@/lib/auth/sso/domain-verification'
import {
  addOrganizationDomain,
  listOrganizationDomains,
} from '@/lib/organizations/application/domain-settings'
import { organizationSecurityOperations } from '@/lib/organizations/application/operations'
import { readSortedCursor, writeSortedCursor } from '@/app/api/v2/lib/response'

export const GET = defineV2JsonRoute({
  contract: v2ListOrganizationDomainsContract,
  operation: organizationSecurityOperations.listDomains,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2SsoErrorPolicy,
  mapInput: ({ params, query }) => ({
    ...params,
    ...query,
    cursorKeys: readSortedCursor(
      query.cursor,
      query.sortBy,
      query.sortOrder,
      cursorScopeKey(cursorRoute(v2ListOrganizationDomainsContract, params), {})
    ),
  }),
  useCase: listOrganizationDomains,
  present: ({ domains, nextCursorKeys }, { params, query }) => ({
    data: domains.map((domain) => toDomainResponse(domain)),
    nextCursor: writeSortedCursor(
      nextCursorKeys,
      query.sortBy,
      query.sortOrder,
      cursorScopeKey(cursorRoute(v2ListOrganizationDomainsContract, params), {})
    ),
  }),
})
export const POST = defineV2JsonRoute({
  contract: v2AddOrganizationDomainContract,
  operation: organizationSecurityOperations.addDomain,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2SsoErrorPolicy,
  mapInput: ({ params, body }) => ({ ...params, ...body }),
  useCase: addOrganizationDomain,
  present: ({ domain }) => ({ data: toDomainResponse(domain) }),
  statusForResult: ({ created }) => (created ? 201 : 200),
})
