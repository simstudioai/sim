import type { OrganizationDelegatedPrincipal, Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { MothershipChatScope } from '@/lib/api/contracts/mothership-chats'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { isChatEnabled } from '@/lib/core/config/env-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { listMothershipChats } from '@/lib/mothership/chat/list-mothership-chats'
import { publishChatStatusChanged } from '@/lib/mothership/chat-status'
import { MOTHERSHIP_CHAT_DEFAULT_MODEL } from '@/lib/mothership/constants'
import { isPlanModeEnabled } from '@/lib/mothership/feature-flags'
import { selectedMemorySpaceForNewChat } from '@/lib/mothership/memory/spaces'
import { ORGANIZATION_SECRETS_AUDIENCE } from '@/lib/organization-secrets/application/operations'

export const organizationChatOperations = {
  subscribe: defineOrganizationOperation({
    id: 'organization.chats.subscribe',
    minimumRole: 'member',
    principalKinds: ['session'],
    capability: 'copilot.use',
  }),
  read: defineOrganizationOperation({
    id: 'organization.chats.read',
    minimumRole: 'member',
    principalKinds: ['session'],
    capability: 'copilot.use',
  }),
  list: defineOrganizationOperation({
    id: 'organization.chats.list',
    contentDelivery: 'none',
    minimumRole: 'member',
    principalKinds: ['session', 'organization_delegated'],
    delegationAudience: 'sim:settings',
    delegatedServices: ['copilot'],
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
  mode?: 'agent' | 'assistant' | 'plan'
  organizationId: string
}

/**
 * Refuses every organization chat when the deployment does not serve chat. Who may chat is
 * otherwise each operation's `copilot.use` capability and membership, never the member's role.
 */
function requireChatDeployment() {
  if (!isChatEnabled) throw new OrchestrationError('not_found', 'Chat is unavailable')
}

/** Plan mode is a rollout of its own; agent and assistant chats need nothing beyond chat access. */
async function requirePlanModeAvailable(userId: string, mode: OrganizationChatInput['mode']) {
  if (mode === 'plan' && !(await isPlanModeEnabled(userId)))
    throw new OrchestrationError('not_found', 'Plan mode is unavailable')
}

/** Rechecks current membership before exposing a private organization conversation. */
export const authorizeOrganizationChat = {
  operation: organizationChatOperations.read,
  async execute({ principal, input }: { principal: Principal; input: OrganizationChatInput }) {
    requireChatDeployment()
    const context = await authorizeOrganizationOperation(
      principal,
      organizationChatOperations.read,
      input
    )
    await requirePlanModeAvailable(context.userId, input.mode)
    return context
  },
}

/** Revalidates the organization surface's rollout and private-chat membership for live updates. */
export const authorizeOrganizationChatEvents = {
  operation: organizationChatOperations.subscribe,
  async execute({ principal, input }: { principal: Principal; input: OrganizationChatInput }) {
    requireChatDeployment()
    return authorizeOrganizationOperation(principal, organizationChatOperations.subscribe, input)
  },
}

export const listOrganizationChats = {
  operation: organizationChatOperations.list,
  async execute({
    principal,
    input,
  }: {
    principal: Principal
    input: OrganizationChatInput & { scope: MothershipChatScope; limit?: number }
  }) {
    requireChatDeployment()
    const context = await authorizeOrganizationOperation(
      principal,
      organizationChatOperations.list,
      input
    )
    return listMothershipChats(
      context.userId,
      { organizationId: context.organizationId },
      input.scope,
      input.limit
    )
  },
}

export const createOrganizationChat = {
  operation: organizationChatOperations.create,
  async execute({ principal, input }: { principal: Principal; input: OrganizationChatInput }) {
    requireChatDeployment()
    const context = await authorizeOrganizationOperation(
      principal,
      organizationChatOperations.create,
      input
    )
    await requirePlanModeAvailable(context.userId, input.mode)
    return createOrganizationChatRecord(context, input.mode ?? 'assistant')
  },
}

/** Called after canonical membership and mode authorization by ordinary chat or benchmark orchestration. */
export async function createOrganizationChatRecord(
  context: { userId: string; organizationId: string },
  mode: 'agent' | 'assistant' | 'plan',
  benchmark?: { id: string; operatorUserId: string }
) {
  const [chat] = await db
    .insert(copilotChats)
    .values({
      userId: context.userId,
      organizationId: context.organizationId,
      memorySpaceId: await selectedMemorySpaceForNewChat(context.userId, context.organizationId),
      type: 'mothership',
      config: { conversationMode: mode, ...(benchmark ? { benchmark } : {}) },
      model: MOTHERSHIP_CHAT_DEFAULT_MODEL,
      lastSeenAt: new Date(),
    })
    .returning({ id: copilotChats.id })
  if (!chat) throw new Error('Failed to create organization conversation')
  if (!benchmark) publishChatStatusChanged(context, { chatId: chat.id, type: 'created' })
  return chat
}

export const organizationChatDelegationOperations = {
  /**
   * permission-group-exempt: Stopping existing work remains available after Copilot is disabled.
   */
  cancel: defineOrganizationOperation({
    id: 'organization.chats.cancel',
    contentDelivery: 'none',
    minimumRole: 'member',
    principalKinds: ['session', 'organization_delegated'],
    capability: 'none',
    delegationAudience: 'sim:copilot-cancel',
    delegatedServices: ['copilot'],
  }),
  settings: defineOrganizationOperation({
    id: 'organization.chats.settings',
    contentDelivery: 'none',
    minimumRole: 'member',
    principalKinds: ['organization_delegated'],
    capability: 'copilot.use',
    delegationAudience: 'sim:settings',
    delegatedServices: ['copilot'],
  }),
  workspaces: defineOrganizationOperation({
    id: 'organization.chats.workspaces',
    contentDelivery: 'none',
    minimumRole: 'member',
    principalKinds: ['organization_delegated'],
    capability: 'copilot.use',
    delegationAudience: 'sim:workspaces',
    delegatedServices: ['copilot'],
  }),
  knowledge: defineOrganizationOperation({
    id: 'organization.chats.knowledge',
    contentDelivery: 'none',
    minimumRole: 'member',
    principalKinds: ['organization_delegated'],
    capability: 'copilot.use',
    delegationAudience: 'sim:knowledge',
    delegatedServices: ['copilot'],
  }),
  assistantActions: defineOrganizationOperation({
    id: 'organization.chats.assistant_actions',
    contentDelivery: 'none',
    minimumRole: 'member',
    principalKinds: ['organization_delegated'],
    delegatedServices: ['copilot'],
    delegationAudience: 'sim:assistant-actions',
    capability: 'copilot.use',
  }),
  secrets: defineOrganizationOperation({
    id: 'organization.chats.secrets',
    contentDelivery: 'none',
    minimumRole: 'member',
    principalKinds: ['organization_delegated'],
    capability: 'copilot.use',
    delegationAudience: ORGANIZATION_SECRETS_AUDIENCE,
    delegatedServices: ['copilot'],
  }),
  billing: defineOrganizationOperation({
    id: 'organization.chats.admit',
    contentDelivery: 'none',
    minimumRole: 'member',
    principalKinds: ['organization_delegated'],
    capability: 'copilot.use',
    delegationAudience: 'sim:copilot-billing',
    delegatedServices: ['copilot'],
  }),
} as const

/** Checks current membership for stopping an owned chat without requiring Copilot to remain enabled. */
export const authorizeOrganizationChatCancellation = {
  operation: organizationChatDelegationOperations.cancel,
  execute({ principal, input }: { principal: Principal; input: OrganizationChatInput }) {
    return authorizeOrganizationOperation(
      principal,
      organizationChatDelegationOperations.cancel,
      input
    )
  },
}

/** A trusted service may act only on the subject's persisted private organization chat. */
export const authorizeOrganizationChatDelegation = {
  async execute({
    principal,
    mode,
  }: {
    principal: OrganizationDelegatedPrincipal
    mode?: 'assistant' | 'agent' | 'plan'
  }) {
    if (principal.serviceId !== 'copilot')
      throw new OrchestrationError('forbidden', 'Invalid conversation delegation')
    const operation = Object.values(organizationChatDelegationOperations).find(
      (candidate) => candidate.delegationAudience === principal.audience
    )
    if (!operation) throw new OrchestrationError('forbidden', 'Invalid conversation delegation')
    if (operation !== organizationChatDelegationOperations.cancel) requireChatDeployment()
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
    await requirePlanModeAvailable(context.userId, mode)
    return context
  },
}
