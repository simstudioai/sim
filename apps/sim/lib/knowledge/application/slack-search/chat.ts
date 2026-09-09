import type { OrganizationDelegatedPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { copilotChats, slackSearchInstallation, slackSearchTurn } from '@sim/db/schema'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { appendCopilotChatMessages } from '@/lib/copilot/chat/messages-store'
import { buildPersistedUserMessage } from '@/lib/copilot/chat/persisted-message'
import { MOTHERSHIP_CHAT_DEFAULT_MODEL } from '@/lib/copilot/constants'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type SlackSearchConversation,
  slackSearchConversation,
  slackSearchConversationKey,
  slackSearchConversationSchema,
} from '@/lib/slack-search/conversation'
import { type SlackSearchJob, slackSearchJobSchema } from '@/lib/slack-search/types'

export const slackSearchChatOperation = defineOrganizationOperation({
  id: 'organization.chats.slack',
  minimumRole: 'member',
  capability: 'copilot.use',
  principalKinds: ['organization_delegated'],
  delegationAudience: 'sim:knowledge',
  delegatedServices: ['slack-search'],
})

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Intake and chat creation hold the installation lock, including before a sender has a Sim account. */
export async function requireSlackSearchConversationSender(
  tx: Transaction,
  conversation: SlackSearchConversation
) {
  const key = slackSearchConversationKey(
    conversation.installationId,
    conversation.channelId,
    conversation.threadTs
  )
  const [first] = await tx
    .select({ payload: slackSearchTurn.payload })
    .from(slackSearchTurn)
    .where(eq(slackSearchTurn.conversationKey, key))
    .orderBy(asc(slackSearchTurn.ordinal))
    .limit(1)
  if (first) {
    const original = slackSearchConversation(slackSearchJobSchema.parse(first.payload))
    if (
      slackSearchConversationKey(original.installationId, original.channelId, original.threadTs) !==
      key
    )
      throw new Error('Persisted Slack event has an inconsistent conversation identity')
    if (original.slackUserId !== conversation.slackUserId)
      throw new OrchestrationError('forbidden', 'Slack thread belongs to another sender')
  }
}

/** Reads the ordinary chat by its unique provider identity, including deleted chats to prevent history rebinding. */
export async function findSlackSearchChatRecord(
  tx: Transaction,
  conversation: SlackSearchConversation
) {
  const [chat] = await tx
    .select()
    .from(copilotChats)
    .where(
      eq(
        copilotChats.externalConversationKey,
        slackSearchConversationKey(
          conversation.installationId,
          conversation.channelId,
          conversation.threadTs
        )
      )
    )
    .limit(1)
  if (chat) {
    const binding = slackSearchConversationSchema.parse(chat.externalConversationMetadata)
    if (
      binding.installationId !== conversation.installationId ||
      binding.channelId !== conversation.channelId ||
      binding.threadTs !== conversation.threadTs ||
      binding.slackUserId !== conversation.slackUserId
    )
      throw new OrchestrationError('forbidden', 'Slack thread identity changed')
  }
  return chat
}

/** Called only after member authorization and while holding the canonical installation lock. */
export async function resolveSlackSearchChatRecord(
  tx: Transaction,
  input: { organizationId: string; userId: string; conversation: SlackSearchConversation }
) {
  if (!input.conversation.channelId.startsWith('D'))
    throw new Error('Slack search history requires a private DM thread')
  await requireSlackSearchConversationSender(tx, input.conversation)
  const existing = await findSlackSearchChatRecord(tx, input.conversation)
  if (existing) {
    if (existing.userId !== input.userId)
      throw new OrchestrationError('forbidden', 'Slack thread belongs to another Sim account')
    if (
      existing.organizationId !== input.organizationId ||
      existing.type !== 'mothership' ||
      existing.deletedAt
    )
      throw new OrchestrationError('not_found', 'The private conversation is no longer available')
    return existing
  }
  const [chat] = await tx
    .insert(copilotChats)
    .values({
      userId: input.userId,
      organizationId: input.organizationId,
      type: 'mothership',
      model: MOTHERSHIP_CHAT_DEFAULT_MODEL,
      lastSeenAt: new Date(),
      externalConversationKey: slackSearchConversationKey(
        input.conversation.installationId,
        input.conversation.channelId,
        input.conversation.threadTs
      ),
      externalConversationMetadata: input.conversation,
    })
    .returning()
  if (!chat) throw new Error('Could not create Slack Search conversation')
  return chat
}

/** Resolves the same private Mothership chat for every event in an authorized Slack conversation. */
export async function resolveSlackSearchChat(
  principal: OrganizationDelegatedPrincipal,
  job: SlackSearchJob
) {
  if (!job.message.channelId.startsWith('D'))
    throw new Error('Slack search answers require a private DM thread')
  if (
    principal.serviceId !== 'slack-search' ||
    principal.resourceScope.installationId !== job.installationId ||
    principal.resourceScope.eventId !== job.message.eventId
  )
    throw new OrchestrationError('forbidden', 'Slack Search authority is required')
  const context = await authorizeOrganizationOperation(
    principal,
    slackSearchChatOperation,
    principal
  )
  return db.transaction(async (tx) => {
    const [installation] = await tx
      .select()
      .from(slackSearchInstallation)
      .where(eq(slackSearchInstallation.id, job.installationId))
      .for('update')
      .limit(1)
    if (
      !installation?.enabled ||
      installation.organizationId !== context.organizationId ||
      installation.revision !== job.revision ||
      installation.credentialVersion !== job.credentialVersion
    )
      throw new OrchestrationError('forbidden', 'Slack Search binding changed')
    return resolveSlackSearchChatRecord(tx, {
      organizationId: context.organizationId,
      userId: context.userId,
      conversation: slackSearchConversation(job),
    })
  })
}

/** The caller holds the shared chat stream lock and freshly authorized the bound conversation. */
export async function persistSlackSearchQuestion(
  chatId: string,
  userId: string,
  userMessageId: string,
  content: string
) {
  await db.transaction(async (tx) => {
    const [chat] = await tx
      .update(copilotChats)
      .set({ conversationId: userMessageId, updatedAt: new Date() })
      .where(
        and(
          eq(copilotChats.id, chatId),
          eq(copilotChats.userId, userId),
          isNull(copilotChats.deletedAt)
        )
      )
      .returning({ model: copilotChats.model })
    if (!chat) throw new OrchestrationError('not_found', 'Conversation not found')
    await appendCopilotChatMessages(
      chatId,
      [buildPersistedUserMessage({ id: userMessageId, content, requestMode: 'assistant' })],
      { streamId: userMessageId, chatModel: chat.model },
      tx
    )
  })
}
