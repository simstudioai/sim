import {
  v2RemoveWorkspaceMemberContract,
  v2UpdateWorkspaceMemberContract,
} from '@/lib/api/contracts/v2/workspaces'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { presentWorkspaceMember } from '@/lib/api/server/workspace-presenters'
import { v2WorkspaceErrorPolicies } from '@/lib/workspaces/api/route-policies'
import { updateWorkspaceMember } from '@/lib/workspaces/application/manage-permissions'
import {
  removeWorkspaceMemberOperation,
  workspacePermissionOperations,
} from '@/lib/workspaces/application/member-operations'
import { removeWorkspaceMember } from '@/lib/workspaces/application/remove-member'

/** PATCH /api/v2/workspaces/[workspaceId]/members/[userId] — Change one member's role. */
export const PATCH = defineV2JsonRoute({
  contract: v2UpdateWorkspaceMemberContract,
  operation: workspacePermissionOperations.update,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkspaceErrorPolicies.manageWorkspaceMembers,
  mapInput: ({ params, body }) => ({
    workspaceId: params.workspaceId,
    userId: params.userId,
    role: body.role,
  }),
  useCase: updateWorkspaceMember,
  present: ({ member }) => ({ data: presentWorkspaceMember(member) }),
})

/** DELETE /api/v2/workspaces/[workspaceId]/members/[userId] — Remove a member, or leave. */
export const DELETE = defineV2JsonRoute({
  contract: v2RemoveWorkspaceMemberContract,
  operation: removeWorkspaceMemberOperation,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkspaceErrorPolicies.manageWorkspaceMembers,
  mapInput: ({ params }) => params,
  useCase: removeWorkspaceMember,
  present: (result) => ({
    data: {
      userId: result.removedUserId,
      deleted: true as const,
      organizationMembershipRemoved: result.organizationRemoval,
    },
  }),
})
