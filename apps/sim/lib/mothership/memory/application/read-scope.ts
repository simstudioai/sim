import type { DelegatedPrincipal, OrganizationDelegatedPrincipal } from '@sim/auth/principal'
import { defineWorkspaceOperation } from '@/lib/core/application'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedChatUseCase } from '@/lib/mothership/chat/application/authorized-chat-use-case'
import { resolveOwnedChatContext } from '@/lib/mothership/chat/application/context'
import type { MemoryScopeRequest } from '@/lib/mothership/generated/memory-scope'

export const MEMORY_SCOPE_AUDIENCE = 'sim:copilot-memory'
export const readMemoryScopeOperation = defineWorkspaceOperation({
  id: 'mothership.memory.read_scope',
  minimumRole: 'read',
  workspaceApiKey: 'deny',
  capability: 'copilot.use',
  principalKinds: ['delegated'],
  delegatedServices: ['copilot'],
})

/** Canonical, currently authorized ownership; never a model-selected graph namespace. */
export const readMemoryScope = defineAuthorizedChatUseCase({
  operation: readMemoryScopeOperation,
  organizationOperation: defineOrganizationOperation({
    id: readMemoryScopeOperation.id,
    minimumRole: 'member',
    capability: readMemoryScopeOperation.capability,
    principalKinds: ['organization_delegated'],
    delegationAudience: MEMORY_SCOPE_AUDIENCE,
    delegatedServices: ['copilot'],
  }),
  resolveContext: ({
    principal,
    input,
  }: {
    principal: DelegatedPrincipal | OrganizationDelegatedPrincipal
    input: MemoryScopeRequest
  }) => resolveOwnedChatContext(principal, input.chatId),
  authorizationOptions: {
    delegation: {
      audience: MEMORY_SCOPE_AUDIENCE,
      isWithinScope: (principal, context) =>
        principal.serviceId === 'copilot' &&
        principal.workspaceId === context.workspaceId &&
        principal.resourceScope?.chatId === context.chatId,
    },
  },
  async execute({ context }) {
    if (context.mode !== 'agent' && context.mode !== 'plan') {
      throw new OrchestrationError('forbidden', 'Private memory requires an interactive agent chat')
    }
    return {
      userId: context.userId,
      organizationId: context.organizationId ?? context.workspaceOrganizationId ?? null,
      workspaceId: context.workspaceId ?? null,
    }
  },
})
