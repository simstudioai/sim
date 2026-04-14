import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import type { PersistedMessage } from '@/lib/copilot/chat/persisted-message'

interface FinalizeAssistantTurnParams {
  chatId: string
  userMessageId: string
  assistantMessage?: PersistedMessage
}

/**
 * Clear the active stream marker for a chat and optionally append the assistant
 * message if a response has not already been persisted immediately after the
 * triggering user message.
 */
export async function finalizeAssistantTurn({
  chatId,
  userMessageId,
  assistantMessage,
}: FinalizeAssistantTurnParams): Promise<void> {
  const [row] = await db
    .select({ messages: copilotChats.messages })
    .from(copilotChats)
    .where(eq(copilotChats.id, chatId))
    .limit(1)

  const messages: Record<string, unknown>[] = Array.isArray(row?.messages) ? row.messages : []
  const userIdx = messages.findIndex((message) => message.id === userMessageId)
  const alreadyHasResponse =
    userIdx >= 0 &&
    userIdx + 1 < messages.length &&
    (messages[userIdx + 1] as Record<string, unknown>)?.role === 'assistant'
  const canAppendAssistant = userIdx >= 0 && userIdx === messages.length - 1 && !alreadyHasResponse
  const updateWhere = and(
    eq(copilotChats.id, chatId),
    eq(copilotChats.conversationId, userMessageId)
  )

  const baseUpdate = {
    conversationId: null,
    updatedAt: new Date(),
  }

  if (assistantMessage && canAppendAssistant) {
    await db
      .update(copilotChats)
      .set({
        ...baseUpdate,
        messages: sql`${copilotChats.messages} || ${JSON.stringify([assistantMessage])}::jsonb`,
      })
      .where(updateWhere)
    return
  }

  await db.update(copilotChats).set(baseUpdate).where(updateWhere)
}
