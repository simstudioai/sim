import type { DelegatedPrincipal, OrganizationDelegatedPrincipal } from '@sim/auth/principal'
import { defineWorkspaceOperation } from '@/lib/core/application'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedChatUseCase } from '@/lib/mothership/chat/application/authorized-chat-use-case'
import { resolveOwnedChatContext } from '@/lib/mothership/chat/application/context'
import { isMemorySpacesEnabled } from '@/lib/mothership/feature-flags'
import type { MemoryScopeRequest } from '@/lib/mothership/generated/memory-scope'
import { signMemoryScope } from '@/lib/mothership/memory/attestation'
import { requireOwnedMemorySpace } from '@/lib/mothership/memory/spaces'

export const MEMORY_SCOPE_AUDIENCE = 'sim:copilot-memory'
export const readMemoryScopeOperation = defineWorkspaceOperation({
  id: 'mothership.memory.read_scope',
  contentDelivery: 'none',
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
    contentDelivery: readMemoryScopeOperation.contentDelivery,
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
    const enabled = await isMemorySpacesEnabled(context.userId)
    const organizationId = context.organizationId ?? context.workspaceOrganizationId ?? null
    if (enabled && context.memorySpaceId) {
      if (!organizationId) throw new OrchestrationError('not_found', 'Knowledge graph not found')
      await requireOwnedMemorySpace(
        { userId: context.userId, organizationId },
        context.memorySpaceId
      )
    }
    const workspaceId = context.workspaceId ?? null
    // Signed only when memory is on: the attestation is what the sidecar trusts, not the worker.
    const attestation = enabled
      ? await signMemoryScope({
          userId: context.userId,
          chatId: context.chatId,
          organizationId,
          workspaceId,
          spaceId: context.memorySpaceId ?? null,
        })
      : null
    return {
      enabled,
      ...(context.memorySpaceId ? { spaceId: context.memorySpaceId } : {}),
      userId: context.userId,
      organizationId,
      workspaceId,
      ...(attestation ? { attestation } : {}),
    }
  },
})
