import type { DelegatedPrincipal, OrganizationDelegatedPrincipal } from '@sim/auth/principal'
import { defineWorkspaceOperation } from '@/lib/core/application'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedChatUseCase } from '@/lib/mothership/chat/application/authorized-chat-use-case'
import { resolveOwnedChatContext } from '@/lib/mothership/chat/application/context'
import { WORKSPACE_TARGET_AUDIENCE } from '@/lib/mothership/chat/application/workspace-target'
import { listOrganizationWorkspaces } from '@/lib/workspaces/application/list-organization-workspaces'

export const readWorkspaceContextOperation = defineWorkspaceOperation({
  id: 'mothership.chats.workspace_context',
  minimumRole: 'read',
  workspaceApiKey: 'deny',
  capability: 'copilot.use',
  principalKinds: ['delegated'],
  delegatedServices: ['copilot'],
})
/** Repeatable private worker preflight; the inventory is not the memory mutation's result. */
export const readWorkspaceContext = defineAuthorizedChatUseCase({
  operation: readWorkspaceContextOperation,
  organizationOperation: defineOrganizationOperation({
    id: readWorkspaceContextOperation.id,
    minimumRole: 'member',
    capability: 'copilot.use',
    principalKinds: ['organization_delegated'],
    delegatedServices: ['copilot'],
    delegationAudience: WORKSPACE_TARGET_AUDIENCE,
  }),
  async resolveContext({
    principal,
    input,
  }: {
    principal: DelegatedPrincipal | OrganizationDelegatedPrincipal
    input: { workspaceId: string }
  }) {
    const chatId =
      principal.resourceScope && 'chatId' in principal.resourceScope
        ? principal.resourceScope.chatId
        : undefined
    if (!chatId) throw new OrchestrationError('not_found', 'Conversation not found')
    return resolveOwnedChatContext(principal, chatId)
  },
  authorizationOptions: {
    delegation: {
      audience: WORKSPACE_TARGET_AUDIENCE,
      isWithinScope: (principal, context) => principal.resourceScope?.chatId === context.chatId,
    },
  },
  async execute({ principal, input, context }) {
    if (
      principal.kind !== 'organization_delegated' ||
      !context.organizationId ||
      context.mode !== 'agent'
    )
      throw new OrchestrationError(
        'forbidden',
        'Workspace discovery requires an organization agent conversation'
      )
    const result = await listOrganizationWorkspaces.execute({
      principal,
      input: { organizationId: context.organizationId, workspaceId: input.workspaceId, limit: 1 },
    })
    return { success: true as const, ...result }
  },
})
