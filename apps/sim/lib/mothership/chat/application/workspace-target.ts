import type { Principal } from '@sim/auth/principal'
import { resolveEffectiveWorkspacePermission } from '@sim/platform-authz/workspace'
import { authorizeWorkspaceOperation, defineWorkspaceOperation } from '@/lib/core/application'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { createCopilotChatPrincipal } from '@/lib/mothership/auth/application-delegation'
import { defineAuthorizedChatUseCase } from '@/lib/mothership/chat/application/authorized-chat-use-case'
import { resolveOwnedChatContext } from '@/lib/mothership/chat/application/context'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

export const WORKSPACE_TARGET_AUDIENCE = 'sim:workspaces'
const targetOperation = defineWorkspaceOperation({
  id: 'mothership.chats.workspace_target',
  minimumRole: 'read',
  workspaceApiKey: 'deny',
  capability: 'copilot.use',
  principalKinds: ['session', 'personal_api_key', 'delegated'],
  delegatedServices: ['copilot'],
})

/** Chat ownership and target membership are separate grants, rechecked before every operation. */
export const authorizeChatWorkspaceTarget = defineAuthorizedChatUseCase({
  operation: targetOperation,
  organizationOperation: defineOrganizationOperation({
    id: targetOperation.id,
    minimumRole: 'member',
    capability: 'copilot.use',
    principalKinds: ['session', 'personal_api_key', 'organization_delegated'],
    delegatedServices: ['copilot'],
    delegationAudience: WORKSPACE_TARGET_AUDIENCE,
  }),
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: { chatId: string; workspaceId: string }
  }) => resolveOwnedChatContext(principal, input.chatId),
  authorizationOptions: {
    delegation: {
      audience: WORKSPACE_TARGET_AUDIENCE,
      isWithinScope: (principal, context) => principal.resourceScope?.chatId === context.chatId,
    },
  },
  async execute({ context, input }) {
    if (context.organizationId && context.mode !== 'agent')
      throw new OrchestrationError('forbidden', 'Workspace actions require organization agent mode')
    const target = await resolveActiveWorkspaceApplicationContext(input.workspaceId)
    if (
      (context.workspaceId && context.workspaceId !== target.workspaceId) ||
      (context.organizationId && context.organizationId !== target.workspaceOrganizationId)
    )
      throw new OrchestrationError('not_found', 'Workspace not found in this conversation')
    const principal = createCopilotChatPrincipal(
      { userId: context.userId, workspaceId: target.workspaceId, chatId: context.chatId },
      WORKSPACE_TARGET_AUDIENCE
    )
    await authorizeWorkspaceOperation(principal, targetOperation, target, {
      delegation: { audience: WORKSPACE_TARGET_AUDIENCE, isWithinScope: () => true },
    })
    const permission = await resolveEffectiveWorkspacePermission(
      context.userId,
      target.workspaceId,
      target.workspaceOrganizationId ?? null
    )
    return {
      workspaceId: target.workspaceId,
      chatId: context.chatId,
      userId: context.userId,
      ...(context.organizationId ? { chatOrganizationId: context.organizationId } : {}),
      permission,
    }
  },
})
