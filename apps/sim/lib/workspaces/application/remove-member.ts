import { AuditAction, AuditResourceType } from '@sim/audit'
import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { defineAuthorizedWorkspaceUseCase, requireCurrentHumanRole } from '@/lib/core/application'
import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'
import { removeWorkspaceMemberRecord } from '@/lib/workspaces/permissions/member-removal-store'

/** permission-group-exempt: members may leave; workspace administrators may remove existing collaborators. */
export const removeWorkspaceMemberOperation = defineWorkspaceOperation({
  id: 'workspaces.members.remove',
  minimumRole: 'read',
  workspaceApiKey: 'deny',
  capability: 'none',
  principalKinds: ['session', 'delegated'],
  delegatedServices: ['copilot'],
})

export interface RemoveWorkspaceMemberInput {
  workspaceId: string
  userId: string
}

export const removeWorkspaceMember = defineAuthorizedWorkspaceUseCase({
  operation: removeWorkspaceMemberOperation,
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
