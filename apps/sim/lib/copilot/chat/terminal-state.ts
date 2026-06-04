import { db } from '@sim/db'
import { copilotChats, copilotMessages } from '@sim/db/schema'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { appendCopilotChatMessages } from '@/lib/copilot/chat/messages-store'
import type { PersistedMessage } from '@/lib/copilot/chat/persisted-message'
import { CopilotChatFinalizeOutcome } from '@/lib/copilot/generated/trace-attribute-values-v1'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { TraceSpan } from '@/lib/copilot/generated/trace-spans-v1'
import { withCopilotSpan } from '@/lib/copilot/request/otel'

type StreamMarkerPolicy = 'active-only' | 'active-or-cleared'

interface FinalizeAssistantTurnParams {
  chatId: string
  userMessageId: string
  userId?: string
  assistantMessage?: PersistedMessage
  streamMarkerPolicy?: StreamMarkerPolicy
}

export interface FinalizeAssistantTurnResult {
  found: boolean
  updated: boolean
  appendedAssistant: boolean
  workspaceId?: string | null
  outcome: (typeof CopilotChatFinalizeOutcome)[keyof typeof CopilotChatFinalizeOutcome]
}

/**
 * Clear the active stream marker for a chat and optionally append the assistant
 * message if a response has not already been persisted immediately after the
 * triggering user message.
 */
export async function finalizeAssistantTurn({
  chatId,
  userMessageId,
  userId,
  assistantMessage,
  streamMarkerPolicy = 'active-only',
}: FinalizeAssistantTurnParams): Promise<FinalizeAssistantTurnResult> {
  return withCopilotSpan(
    TraceSpan.CopilotChatFinalizeAssistantTurn,
    {
      [TraceAttr.DbSystem]: 'postgresql',
      [TraceAttr.DbSqlTable]: 'copilot_chats',
      [TraceAttr.ChatId]: chatId,
      [TraceAttr.ChatUserMessageId]: userMessageId,
      [TraceAttr.ChatHasAssistantMessage]: !!assistantMessage,
    },
    async (span) => {
      const result = await db.transaction(async (tx) => {
        const where = userId
          ? and(eq(copilotChats.id, chatId), eq(copilotChats.userId, userId))
          : eq(copilotChats.id, chatId)
        const [row] = await tx
          .select({
            conversationId: copilotChats.conversationId,
            workspaceId: copilotChats.workspaceId,
            model: copilotChats.model,
          })
          .from(copilotChats)
          .where(where)
          .for('update')
          .limit(1)

        if (!row) {
          return {
            found: false,
            updated: false,
            appendedAssistant: false,
            workspaceId: null,
            outcome: CopilotChatFinalizeOutcome.StaleUserMessage,
          }
        }

        const chatModel = row.model ?? null

        const markerMatches = row.conversationId === userMessageId
        const markerAlreadyCleared = row.conversationId === null
        const ownsTurn =
          markerMatches || (streamMarkerPolicy === 'active-or-cleared' && markerAlreadyCleared)
        if (!ownsTurn) {
          return {
            found: true,
            updated: false,
            appendedAssistant: false,
            workspaceId: row.workspaceId,
            outcome: CopilotChatFinalizeOutcome.StaleUserMessage,
          }
        }

        // Append only when the user message is still the last row: anything
        // after it means the turn already has a response (dedup under the lock).
        const [lastMessage] = await tx
          .select({ messageId: copilotMessages.messageId, role: copilotMessages.role })
          .from(copilotMessages)
          .where(and(eq(copilotMessages.chatId, chatId), isNull(copilotMessages.deletedAt)))
          .orderBy(
            sql`${copilotMessages.seq} desc nulls last`,
            desc(copilotMessages.createdAt),
            desc(copilotMessages.id)
          )
          .limit(1)
        const canAppendAssistant = lastMessage?.messageId === userMessageId
        const alreadyHasResponse = lastMessage?.role === 'assistant'

        const updateWhere = userId
          ? and(eq(copilotChats.id, chatId), eq(copilotChats.userId, userId))
          : eq(copilotChats.id, chatId)
        const baseUpdate = {
          conversationId: null,
          updatedAt: new Date(),
        }

        if (assistantMessage && canAppendAssistant) {
          await tx.update(copilotChats).set(baseUpdate).where(updateWhere)
          await appendCopilotChatMessages(
            chatId,
            [assistantMessage],
            { streamId: userMessageId, chatModel },
            tx
          )
          return {
            found: true,
            updated: true,
            appendedAssistant: true,
            workspaceId: row.workspaceId,
            outcome: CopilotChatFinalizeOutcome.AppendedAssistant,
          }
        }

        if (markerMatches) {
          await tx.update(copilotChats).set(baseUpdate).where(updateWhere)
          return {
            found: true,
            updated: true,
            appendedAssistant: false,
            workspaceId: row.workspaceId,
            outcome: assistantMessage
              ? CopilotChatFinalizeOutcome.AssistantAlreadyPersisted
              : CopilotChatFinalizeOutcome.ClearedStreamMarkerOnly,
          }
        }

        return {
          found: true,
          updated: false,
          appendedAssistant: false,
          workspaceId: row.workspaceId,
          outcome: alreadyHasResponse
            ? CopilotChatFinalizeOutcome.AssistantAlreadyPersisted
            : CopilotChatFinalizeOutcome.StaleUserMessage,
        }
      })

      span.setAttribute(TraceAttr.ChatFinalizeOutcome, result.outcome)
      return result
    }
  )
}
