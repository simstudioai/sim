import type { DelegatedPrincipal, OrganizationDelegatedPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { resolvePayerOrganizationId } from '@/lib/billing/core/payer-organization'
import { defineWorkspaceOperation } from '@/lib/core/application'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedChatUseCase } from '@/lib/mothership/chat/application/authorized-chat-use-case'
import { resolveOwnedChatContext } from '@/lib/mothership/chat/application/context'
import { isMemorySpacesEnabled } from '@/lib/mothership/feature-flags'
import type { MemoryScopeRequest } from '@/lib/mothership/generated/memory-scope'
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
    // A chosen space belongs to an organization, a personal one included; without one to own it
    // the chat keeps the default graph.
    const spaceOrganizationId = context.organizationId ?? context.workspaceOrganizationId ?? null
    const spaceId = spaceOrganizationId ? context.memorySpaceId : null
    if (enabled && spaceOrganizationId && spaceId) {
      await requireOwnedMemorySpace(
        { userId: context.userId, organizationId: spaceOrganizationId },
        spaceId
      )
    }
    // The worker keys a graph by this id (`["organization", id]`, else `["personal"]`). A personal
    // workspace moved into its owner's personal organization keeps the personal graph it had, so a
    // workspace chat names only a team (the payer rule); an organization chat names its own.
    const graphOrganizationId =
      context.organizationId ??
      (await resolvePayerOrganizationId(db, context.workspaceOrganizationId ?? null))
    return {
      enabled,
      ...(spaceId ? { spaceId } : {}),
      userId: context.userId,
      organizationId: graphOrganizationId,
      workspaceId: context.workspaceId ?? null,
    }
  },
})
