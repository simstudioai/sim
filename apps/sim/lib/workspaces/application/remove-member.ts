import { AuditAction, AuditResourceType } from '@sim/audit'
import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { defineAuthorizedWorkspaceUseCase, requireCurrentHumanRole } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/context'
import { workspaceMemberOperations } from '@/lib/workspaces/application/operations'
import { removeWorkspaceMemberRecord } from '@/lib/workspaces/permissions/member-removal-store'

export interface RemoveWorkspaceMemberInput {
  workspaceId: string
  userId: string
}

export const removeWorkspaceMember = defineAuthorizedWorkspaceUseCase({
  operation: workspaceMemberOperations.remove,
  resolveContext: ({ input }: { input: RemoveWorkspaceMemberInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: { delegation: { audience: 'sim:settings', isWithinScope: () => true } },
  async execute({ principal, input, context }) {
    const actorId = requirePrincipalSubjectUserId(principal)
    if (!input.userId) throw new OrchestrationError('validation', 'User ID is required')
    if (input.userId !== actorId) await requireCurrentHumanRole(actorId, context, 'admin')
    return removeWorkspaceMemberRecord(
      context.workspaceId,
      input.userId,
      actorId,
      principal.kind === 'session' && input.userId === actorId ? principal.sessionId : undefined
    )
  },
  projectAudit: ({ context, result }) => ({
    action: AuditAction.MEMBER_REMOVED,
    resourceType: AuditResourceType.WORKSPACE,
    resourceId: context.workspaceId,
    description: result.selfRemoval
      ? result.organizationRemoval
        ? 'Left the organization'
        : 'Left the workspace'
      : result.organizationRemoval
        ? `Removed member ${result.removedUserId} from the organization`
        : `Removed member ${result.removedUserId} from the workspace`,
    metadata: result,
  }),
})
