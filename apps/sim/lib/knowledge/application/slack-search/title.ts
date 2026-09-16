import type { OrganizationDelegatedPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { copilotChats, slackSearchTurn } from '@sim/db/schema'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { requestChatTitle } from '@/lib/copilot/request/lifecycle/start'
import { resolveSlackSearchChat } from '@/lib/knowledge/application/slack-search/chat'
import { type SlackSearchJob, slackSearchJobSchema } from '@/lib/slack-search/types'

/** Uses normal chat naming on the original question and preserves concurrent manual renames. */
export async function generateSlackSearchChatTitle(
  principal: OrganizationDelegatedPrincipal,
  input: { job: SlackSearchJob; signal: AbortSignal; beforePersist: () => Promise<void> }
) {
  const chat = await resolveSlackSearchChat(principal, input.job)
  if (chat.title && chat.title !== 'Slack Search') return
  if (!chat.externalConversationKey) throw new Error('Slack conversation binding is missing')
  const [first] = await db
    .select({ payload: slackSearchTurn.payload })
    .from(slackSearchTurn)
    .where(eq(slackSearchTurn.conversationKey, chat.externalConversationKey))
    .orderBy(asc(slackSearchTurn.ordinal))
    .limit(1)
  if (!first) throw new Error('Slack conversation has no original question')
  const original = slackSearchJobSchema.parse(first.payload)
  const title = await requestChatTitle({
    chatId: chat.id,
    message: original.message.query,
    model: chat.model,
    userId: chat.userId,
    organizationId: principal.organizationId,
    signal: AbortSignal.any([input.signal, AbortSignal.timeout(15_000)]),
  })
  if (!title) return
  await input.beforePersist()
  await resolveSlackSearchChat(principal, input.job)
  await db
    .update(copilotChats)
    .set({ title: title.endsWith(' (Slack)') ? title : `${title} (Slack)` })
    .where(
      and(
        eq(copilotChats.id, chat.id),
        eq(copilotChats.userId, chat.userId),
        eq(copilotChats.organizationId, principal.organizationId),
        eq(copilotChats.externalConversationKey, chat.externalConversationKey),
        isNull(copilotChats.deletedAt),
        chat.title === null ? isNull(copilotChats.title) : eq(copilotChats.title, chat.title)
      )
    )
}
