import type { DelegatedPrincipal, OrganizationDelegatedPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm'
import { defineWorkspaceOperation } from '@/lib/core/application'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedChatUseCase } from '@/lib/mothership/chat/application/authorized-chat-use-case'
import {
  requireOwnedChatReadable,
  resolveOwnedChatContext,
} from '@/lib/mothership/chat/application/context'
import { conversationModeSelection } from '@/lib/mothership/chat/intent'
import { requireOrganizationBuildPermission } from '@/lib/mothership/chat/organization-chats'
import { isPlanModeEnabled } from '@/lib/mothership/feature-flags'
import type {
  RecallChatsRequest,
  RecallChatsResponse,
} from '@/lib/mothership/generated/chat-recall'

export const RECALL_CHATS_AUDIENCE = 'sim:copilot-recall'
export const readRecallChatsOperation = defineWorkspaceOperation({
  id: 'mothership.chats.recall',
  contentDelivery: 'none',
  minimumRole: 'read',
  workspaceApiKey: 'deny',
  capability: 'copilot.use',
  principalKinds: ['delegated'],
  delegatedServices: ['copilot'],
})
const readRecallChatsOrganizationOperation = defineOrganizationOperation({
  id: readRecallChatsOperation.id,
  contentDelivery: readRecallChatsOperation.contentDelivery,
  minimumRole: 'member',
  capability: readRecallChatsOperation.capability,
  principalKinds: ['organization_delegated'],
  delegationAudience: RECALL_CHATS_AUDIENCE,
  delegatedServices: ['copilot'],
})

/**
 * The chats an agent chat may read back besides itself: its owner's live home chats in the same
 * workspace or organization that the owner may open now, most recently updated first. Deleted chats
 * are gone here at once, though their events stay in the worker's log until cleanup.
 *
 * The requesting chat must itself be readable as Sim's read path checks it; that also grants the
 * organization build permission every listed agent or plan chat needs, so the list only drops plan
 * chats while Plan mode is off. Assistant chats are listed: they are the owner's own conversations.
 */
export const readRecallChats = defineAuthorizedChatUseCase({
  operation: readRecallChatsOperation,
  organizationOperation: readRecallChatsOrganizationOperation,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: DelegatedPrincipal | OrganizationDelegatedPrincipal
    input: RecallChatsRequest
  }) => resolveOwnedChatContext(principal, input.chatId),
  authorizationOptions: {
    delegation: {
      audience: RECALL_CHATS_AUDIENCE,
      isWithinScope: (principal, context) =>
        principal.serviceId === 'copilot' &&
        principal.workspaceId === context.workspaceId &&
        principal.resourceScope?.chatId === context.chatId,
    },
  },
  async execute({ principal, context, input }): Promise<RecallChatsResponse> {
    if (context.type !== 'mothership') throw new OrchestrationError('not_found', 'Chat not found')
    if (context.mode !== 'agent' && context.mode !== 'plan') {
      throw new OrchestrationError('forbidden', 'Reading other chats requires an agent chat')
    }
    const planEnabled = await isPlanModeEnabled(context.userId)
    if (context.organizationId) {
      const { role } = await authorizeOrganizationOperation(
        principal,
        readRecallChatsOrganizationOperation,
        { organizationId: context.organizationId }
      )
      await requireOrganizationBuildPermission({ organizationId: context.organizationId, role })
      if (context.mode === 'plan' && !planEnabled)
        throw new OrchestrationError('not_found', 'Plan mode is unavailable')
    } else {
      await requireOwnedChatReadable(context)
    }
    const owner = context.organizationId
      ? eq(copilotChats.organizationId, context.organizationId)
      : context.workspaceId
        ? eq(copilotChats.workspaceId, context.workspaceId)
        : undefined
    if (!owner) throw new OrchestrationError('not_found', 'Chat not found')
    const chats = await db
      .select({ id: copilotChats.id, title: copilotChats.title, updatedAt: copilotChats.updatedAt })
      .from(copilotChats)
      .where(
        and(
          eq(copilotChats.userId, context.userId),
          owner,
          eq(copilotChats.type, 'mothership'),
          sql`${copilotChats.config}->'benchmark' IS NULL`,
          isNull(copilotChats.deletedAt),
          ne(copilotChats.id, context.chatId),
          planEnabled ? undefined : sql`${conversationModeSelection} <> 'plan'`
        )
      )
      .orderBy(desc(copilotChats.updatedAt), desc(copilotChats.id))
      .limit(input.limit)
    return {
      userId: context.userId,
      chats: chats.map(({ id, title, updatedAt }) => ({
        id,
        title,
        updatedAt: updatedAt.toISOString(),
      })),
    }
  },
})
