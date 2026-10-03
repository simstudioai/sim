import { v2ListOrganizationInvitationWorkspacesContract } from '@/lib/api/contracts/v2/organizations'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2OrganizationErrorPolicy } from '@/lib/api/server/routes/organizations'
import { organizationOperations } from '@/lib/organizations/application/operations'
import { listOrganizationInvitationWorkspaces } from '@/lib/organizations/application/reads'
import { readSortedCursor, writeSortedCursor } from '@/app/api/v2/lib/response'

export const GET = defineV2JsonRoute({
  contract: v2ListOrganizationInvitationWorkspacesContract,
  operation: organizationOperations.listInvitationWorkspaces,
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
      cursorScopeKey(cursorRoute(v2ListOrganizationInvitationWorkspacesContract, params), {
        search: query.search,
      })
    ),
  }),
  useCase: listOrganizationInvitationWorkspaces,
  present: ({ data, nextCursorKeys }, { params, query }) => ({
    data: data.map((workspace) => ({
      ...workspace,
      archivedAt: workspace.archivedAt?.toISOString() ?? null,
    })),
    nextCursor: writeSortedCursor(
      nextCursorKeys,
      query.sortBy,
      query.sortOrder,
      cursorScopeKey(cursorRoute(v2ListOrganizationInvitationWorkspacesContract, params), {
        search: query.search,
      })
    ),
  }),
})
