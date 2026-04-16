import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import type { PersistedMessage } from '@/lib/copilot/chat/persisted-message'
import { TraceSpan } from '@/lib/copilot/generated/trace-spans-v1'
import { withCopilotSpan } from '@/lib/copilot/request/otel'

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
  return withCopilotSpan(
    TraceSpan.CopilotChatFinalizeAssistantTurn,
    {
      'db.system': 'postgresql',
      'db.sql.table': 'copilot_chats',
      'chat.id': chatId,
      'chat.user_message_id': userMessageId,
      'chat.has_assistant_message': !!assistantMessage,
    },
    async (span) => {
      const [row] = await db
        .select({ messages: copilotChats.messages })
        .from(copilotChats)
        .where(eq(copilotChats.id, chatId))
        .limit(1)

      const messages: Record<string, unknown>[] = Array.isArray(row?.messages) ? row.messages : []
      span.setAttribute('chat.existing_message_count', messages.length)
      const userIdx = messages.findIndex((message) => message.id === userMessageId)
      const alreadyHasResponse =
        userIdx >= 0 &&
        userIdx + 1 < messages.length &&
        (messages[userIdx + 1] as Record<string, unknown>)?.role === 'assistant'
      const canAppendAssistant =
        userIdx >= 0 && userIdx === messages.length - 1 && !alreadyHasResponse
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
        span.setAttribute('chat.finalize.outcome', 'appended_assistant')
        return
      }

      await db.update(copilotChats).set(baseUpdate).where(updateWhere)
      span.setAttribute(
        'chat.finalize.outcome',
        assistantMessage
          ? alreadyHasResponse
            ? 'assistant_already_persisted'
            : 'stale_user_message'
          : 'cleared_stream_marker_only'
      )
    }
  )
}
