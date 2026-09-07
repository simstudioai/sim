import type { OrganizationDelegatedPrincipal, Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { MothershipChatScope } from '@/lib/api/contracts/mothership-chats'
import { listMothershipChats } from '@/lib/copilot/chat/list-mothership-chats'
import { MOTHERSHIP_CHAT_DEFAULT_MODEL } from '@/lib/copilot/constants'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'

export const organizationChatOperations = {
  read: defineOrganizationOperation({
    id: 'organization.chats.read',
    minimumRole: 'member',
    principalKinds: ['session'],
    capability: 'copilot.use',
  }),
  list: defineOrganizationOperation({
    id: 'organization.chats.list',
    minimumRole: 'member',
    principalKinds: ['session'],
    capability: 'copilot.use',
  }),
  create: defineOrganizationOperation({
    id: 'organization.chats.create',
    minimumRole: 'member',
    principalKinds: ['session'],
    capability: 'copilot.use',
  }),
} as const

interface OrganizationChatInput {
  organizationId: string
}

/** Rechecks current membership before exposing a private organization conversation. */
export const authorizeOrganizationChat = {
  operation: organizationChatOperations.read,
  execute({ principal, input }: { principal: Principal; input: OrganizationChatInput }) {
    return authorizeOrganizationOperation(principal, organizationChatOperations.read, input)
  },
}

export const listOrganizationChats = {
  operation: organizationChatOperations.list,
  async execute({
    principal,
    input,
  }: {
    principal: Principal
    input: OrganizationChatInput & { scope: MothershipChatScope }
  }) {
    const context = await authorizeOrganizationOperation(
      principal,
      organizationChatOperations.list,
      input
    )
    return listMothershipChats(
      context.userId,
      { organizationId: context.organizationId },
      input.scope
    )
  },
}

export const createOrganizationChat = {
  operation: organizationChatOperations.create,
  async execute({ principal, input }: { principal: Principal; input: OrganizationChatInput }) {
    const context = await authorizeOrganizationOperation(
      principal,
      organizationChatOperations.create,
      input
    )
    const [chat] = await db
      .insert(copilotChats)
      .values({
        userId: context.userId,
        organizationId: context.organizationId,
        type: 'mothership',
        model: MOTHERSHIP_CHAT_DEFAULT_MODEL,
        lastSeenAt: new Date(),
      })
      .returning({ id: copilotChats.id })
    if (!chat) throw new Error('Failed to create organization conversation')
    return chat
  },
}

export const organizationChatDelegationOperations = {
  knowledge: defineOrganizationOperation({
    id: 'organization.chats.knowledge',
    minimumRole: 'member',
    principalKinds: ['organization_delegated'],
    capability: 'copilot.use',
    delegationAudience: 'sim:knowledge',
  }),
  billing: defineOrganizationOperation({
    id: 'organization.chats.admit',
    minimumRole: 'member',
    principalKinds: ['organization_delegated'],
    capability: 'copilot.use',
    delegationAudience: 'sim:copilot-billing',
  }),
} as const

/** A trusted service may act only on the subject's persisted private organization chat. */
export const authorizeOrganizationChatDelegation = {
  async execute({ principal }: { principal: OrganizationDelegatedPrincipal }) {
    const operation = Object.values(organizationChatDelegationOperations).find(
      (candidate) => candidate.delegationAudience === principal.audience
    )
    if (!operation) throw new OrchestrationError('forbidden', 'Invalid conversation delegation')
    const context = await authorizeOrganizationOperation(principal, operation, {
      organizationId: principal.organizationId,
    })
    const [chat] = await db
      .select({ id: copilotChats.id })
      .from(copilotChats)
      .where(
        and(
          eq(copilotChats.id, principal.resourceScope.chatId),
          eq(copilotChats.organizationId, context.organizationId),
          eq(copilotChats.userId, context.userId),
          eq(copilotChats.type, 'mothership'),
          isNull(copilotChats.deletedAt)
        )
      )
      .limit(1)
    if (!chat) throw new OrchestrationError('not_found', 'Conversation not found')
    return context
  },
}
