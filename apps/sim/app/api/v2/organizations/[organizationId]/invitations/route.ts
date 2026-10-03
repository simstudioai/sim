import {
  v2CreateOrganizationInvitationContract,
  v2ListOrganizationInvitationsContract,
} from '@/lib/api/contracts/v2/organizations'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import { presentOrganizationInvitation } from '@/lib/api/server/organization-presenters'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2OrganizationErrorPolicy } from '@/lib/api/server/routes/organizations'
import { createOrganizationInvitation } from '@/lib/organizations/application/invitations'
import { organizationOperations } from '@/lib/organizations/application/operations'
import { listOrganizationInvitations } from '@/lib/organizations/application/reads'
import { readSortedCursor, writeSortedCursor } from '@/app/api/v2/lib/response'

export const GET = defineV2JsonRoute({
  contract: v2ListOrganizationInvitationsContract,
  operation: organizationOperations.listInvitations,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrganizationErrorPolicy,
  mapInput: ({ params, query }) => ({
    ...params,
    ...query,
    cursorKeys: readSortedCursor(
      query.cursor,
      query.sortBy,
      query.sortOrder,
      cursorScopeKey(cursorRoute(v2ListOrganizationInvitationsContract, params), {
        search: query.search,
        status: query.status,
      })
    ),
  }),
  useCase: listOrganizationInvitations,
  present: ({ data, nextCursorKeys }, { params, query }) => ({
    data: data.map(presentOrganizationInvitation),
    nextCursor: writeSortedCursor(
      nextCursorKeys,
      query.sortBy,
      query.sortOrder,
      cursorScopeKey(cursorRoute(v2ListOrganizationInvitationsContract, params), {
        search: query.search,
        status: query.status,
      })
    ),
  }),
})

export const POST = defineV2JsonRoute({
  contract: v2CreateOrganizationInvitationContract,
  operation: organizationOperations.createInvitation,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrganizationErrorPolicy,
  mapInput: ({ params, body }) => ({ ...params, ...body }),
  useCase: createOrganizationInvitation,
  present: (invitation) => ({ data: presentOrganizationInvitation(invitation) }),
})
