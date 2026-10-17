import { delegatedChatId, type Principal } from '@sim/auth/principal'
import { resolveEffectiveWorkspacePermission } from '@sim/platform-authz/workspace'
import { defineWorkspaceOperation } from '@/lib/core/application'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { requireCurrentHumanRole } from '@/lib/core/application/workspace-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedChatUseCase } from '@/lib/mothership/chat/application/authorized-chat-use-case'
import { resolveOwnedChatContext } from '@/lib/mothership/chat/application/context'
import { requireAdmittedWorkspaceTarget } from '@/lib/mothership/request/application/run-authorization'
import { assertWorkspaceCapability } from '@/lib/permission-groups/capability-assertions'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/context'

export const WORKSPACE_TARGET_AUDIENCE = 'sim:workspaces'
const targetOperation = defineWorkspaceOperation({
  id: 'mothership.chats.workspace_target',
  minimumRole: 'read',
  workspaceApiKey: 'deny',
  capability: 'copilot.use',
  contentDelivery: 'none',
  principalKinds: ['session', 'personal_api_key', 'delegated'],
  delegatedServices: ['copilot'],
})

/** Chat ownership and target membership are separate grants, rechecked before every operation. */
export const authorizeChatWorkspaceTarget = defineAuthorizedChatUseCase({
  personal: true,
  executionDelegationAudience: WORKSPACE_TARGET_AUDIENCE,
  operation: targetOperation,
  organizationOperation: defineOrganizationOperation({
    id: targetOperation.id,
    contentDelivery: 'none',
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
      isWithinScope: (principal, context) => delegatedChatId(principal) === context.chatId,
    },
  },
  async execute({ context, input, executionPrincipal }) {
    await requireAdmittedWorkspaceTarget(executionPrincipal, input.workspaceId)
    if (context.organizationId && context.mode !== 'agent' && context.mode !== 'plan')
      throw new OrchestrationError('forbidden', 'Workspace actions require organization agent mode')
    const target = await resolveActiveWorkspaceApplicationContext(input.workspaceId)
    if (
      (context.workspaceId && context.workspaceId !== target.workspaceId) ||
      (context.organizationId && context.organizationId !== target.workspaceOrganizationId) ||
      (!context.workspaceId && !context.organizationId && target.workspaceOrganizationId !== null)
    )
      throw new OrchestrationError('not_found', 'Workspace not found in this conversation')
    await requireCurrentHumanRole(context.userId, target, targetOperation.minimumRole)
    if (target.workspaceOrganizationId !== null && targetOperation.capability !== 'none')
      await assertWorkspaceCapability(
        context.userId,
        target.workspaceId,
        targetOperation.capability,
        target.workspaceOrganizationId
      )
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
