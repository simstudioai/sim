import { removeWorkspaceMemberContract } from '@/lib/api/contracts/invitations'
import {
  defineInternalJsonRoute,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  InsufficientWorkspacePermissionsError,
  NoWorkspaceAccessError,
} from '@/lib/core/application/workspace-authorization'
import { captureServerEvent } from '@/lib/posthog/server'
import { workspaceMemberOperations } from '@/lib/workspaces/application/operations'
import { removeWorkspaceMember } from '@/lib/workspaces/application/remove-member'
import { WorkspaceBillingAccountRemovalError } from '@/lib/workspaces/utils'

export const DELETE = defineInternalJsonRoute({
  contract: removeWorkspaceMemberContract,
  auth: internalSessionAuth,
  operation: workspaceMemberOperations.remove,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing workspace member removal policy.',
  }),
  errorPolicy: {
    project(error) {
      if (error instanceof WorkspaceBillingAccountRemovalError)
        return internalErrorResponse(400, { error: error.message })
      if (
        error instanceof InsufficientWorkspacePermissionsError ||
        error instanceof NoWorkspaceAccessError
      )
        return internalErrorResponse(403, { error: 'Insufficient permissions' })
      return internalOrchestrationErrorPolicy.project(error)
    },
    unhandled: () => internalErrorResponse(500, { error: 'Failed to remove workspace member' }),
  },
  mapInput: ({ params, body }) => ({ workspaceId: body.workspaceId, userId: params.id }),
  useCase: removeWorkspaceMember,
  present: () => ({ success: true }),
  onSuccess: ({ principal, input, result }) => {
    captureServerEvent(
      principal.userId,
      'workspace_member_removed',
      { workspace_id: input.workspaceId, is_self_removal: result.selfRemoval },
      { groups: { workspace: input.workspaceId } }
    )
  },
})
