import { isUserCredentialPrincipal } from '@sim/auth/principal'
import {
  v2RemoveWorkspaceMemberContract,
  v2UpdateWorkspaceMemberContract,
} from '@/lib/api/contracts/v2/workspaces'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { presentWorkspaceMember } from '@/lib/api/server/workspace-presenters'
import { captureServerEvent } from '@/lib/posthog/server'
import { v2WorkspaceErrorPolicies } from '@/lib/workspaces/api/route-policies'
import { updateWorkspaceMember } from '@/lib/workspaces/application/manage-permissions'
import {
  workspaceMemberOperations,
  workspacePermissionOperations,
} from '@/lib/workspaces/application/operations'
import { removeWorkspaceMember } from '@/lib/workspaces/application/remove-member'

/** PATCH /api/v2/workspaces/[workspaceId]/members/[userId] — Change one member's role. */
export const PATCH = defineV2JsonRoute({
  contract: v2UpdateWorkspaceMemberContract,
  operation: workspacePermissionOperations.update,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkspaceErrorPolicies.manageWorkspaceMembers,
  mapInput: ({ params, body }) => ({ ...params, ...body }),
  useCase: updateWorkspaceMember,
  present: ({ member }) => ({ data: presentWorkspaceMember(member) }),
  onSuccess: ({ principal, input, result }) => {
    if (!isUserCredentialPrincipal(principal)) return
    for (const change of result.changes) {
      captureServerEvent(
        principal.userId,
        'workspace_member_role_changed',
        { workspace_id: input.workspaceId, new_role: change.newRole },
        { groups: { workspace: input.workspaceId } }
      )
    }
  },
})

/** DELETE /api/v2/workspaces/[workspaceId]/members/[userId] — Remove a member, or leave. */
export const DELETE = defineV2JsonRoute({
  contract: v2RemoveWorkspaceMemberContract,
  operation: workspaceMemberOperations.remove,
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
  onSuccess: ({ principal, input, result }) => {
    if (!isUserCredentialPrincipal(principal)) return
    captureServerEvent(
      principal.userId,
      'workspace_member_removed',
      { workspace_id: input.workspaceId, is_self_removal: result.selfRemoval },
      { groups: { workspace: input.workspaceId } }
    )
  },
})
