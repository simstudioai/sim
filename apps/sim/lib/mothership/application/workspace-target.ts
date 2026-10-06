import type { ExternalMailerRestriction } from '@sim/auth/principal'
import { authorizeWorkspaceOperation, defineWorkspaceOperation } from '@/lib/core/application'
import { resolveExecutionRestriction } from '@/lib/core/application/execution-restriction'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  COPILOT_APPLICATION_DELEGATION_TTL_MS,
  createCopilotChatPrincipal,
  createTrustedOrganizationCopilotPrincipal,
} from '@/lib/mothership/auth/application-delegation'
import {
  authorizeChatWorkspaceTarget,
  WORKSPACE_TARGET_AUDIENCE,
} from '@/lib/mothership/chat/application/workspace-target'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

export interface InvocationOwner {
  executionRestriction?: ExternalMailerRestriction
  userId: string
  workspaceId?: string
  organizationId?: string
  chatOrganizationId?: string
  chatId?: string
}

/** Resolve a requested target against immutable server-owned chat scope, never profiles or prior calls. */
export async function resolveInvocationWorkspace(owner: InvocationOwner, requested?: string) {
  const restriction = resolveExecutionRestriction(owner.executionRestriction)
  if (
    restriction &&
    (owner.organizationId ||
      owner.chatOrganizationId ||
      owner.workspaceId !== restriction.workspaceId ||
      (requested && requested !== restriction.workspaceId))
  )
    throw new OrchestrationError('forbidden', 'Workspace outside external Mailer admission')
  const organizationId = owner.chatOrganizationId ?? owner.organizationId
  const workspaceId = requested ?? (organizationId ? undefined : owner.workspaceId)
  if (!workspaceId?.trim() || workspaceId !== workspaceId.trim())
    throw new OrchestrationError(
      'validation',
      'Every organization CLI or workspace operation requires an explicit workspace ID'
    )
  if (!organizationId && owner.workspaceId && workspaceId !== owner.workspaceId)
    throw new OrchestrationError('not_found', 'Workspace not found in this conversation')
  if (owner.chatId) {
    const principal = organizationId
      ? createTrustedOrganizationCopilotPrincipal(
          {
            userId: owner.userId,
            organizationId,
            chatId: owner.chatId,
            delegationId: `workspace-target:${owner.chatId}`,
          },
          { audience: WORKSPACE_TARGET_AUDIENCE, ttlMs: COPILOT_APPLICATION_DELEGATION_TTL_MS }
        )
      : createCopilotChatPrincipal(
          {
            executionRestriction: restriction,
            userId: owner.userId,
            workspaceId,
            chatId: owner.chatId,
          },
          WORKSPACE_TARGET_AUDIENCE
        )
    return authorizeChatWorkspaceTarget.execute({
      principal,
      input: { chatId: owner.chatId, workspaceId },
    })
  }
  if (organizationId)
    throw new OrchestrationError('validation', 'Organization operations require an owned chat')
  const context = await resolveActiveWorkspaceApplicationContext(workspaceId)
  const principal = createCopilotChatPrincipal(
    { executionRestriction: restriction, userId: owner.userId, workspaceId },
    WORKSPACE_TARGET_AUDIENCE
  )
  await authorizeWorkspaceOperation(principal, headlessTargetOperation, context, {
    delegation: { audience: WORKSPACE_TARGET_AUDIENCE, isWithinScope: () => true },
  })
  return { workspaceId, userId: owner.userId, permission: undefined }
}

const headlessTargetOperation = defineWorkspaceOperation({
  id: 'mothership.workspace_target',
  minimumRole: 'read',
  restrictedExternalAccess: 'workspace_read',
  workspaceApiKey: 'deny',
  capability: 'copilot.use',
  principalKinds: ['delegated'],
  delegatedServices: ['copilot'],
})
