import { db } from '@sim/db'
import { copilotChats, copilotMessages, copilotRuns } from '@sim/db/schema'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { buildLiveAssistantMessage } from '@/lib/mothership/chat/effective-transcript'
import { appendCopilotChatMessages } from '@/lib/mothership/chat/messages-store'
import {
  type PersistedMessage,
  withStoppedContentBlock,
} from '@/lib/mothership/chat/persisted-message'
import {
  mergeAndRedactPersistedBlocks,
  redactSensitiveContent,
} from '@/lib/mothership/chat/sim-key-redaction'
import { CopilotChatFinalizeOutcome } from '@/lib/mothership/generated/trace-attribute-values-v1'
import { TraceAttr } from '@/lib/mothership/generated/trace-attributes-v1'
import { TraceSpan } from '@/lib/mothership/generated/trace-spans-v1'
import { withCopilotSpan } from '@/lib/mothership/request/otel'
import { readEvents } from '@/lib/mothership/request/session/buffer'
import { StreamControllerSupersededError } from '@/lib/mothership/request/session/controller-lease'
import { toStreamBatchEvent } from '@/lib/mothership/request/session/types'

type StreamMarkerPolicy = 'active-only' | 'active-or-cleared'

interface FinalizeAssistantTurnParams {
  chatId: string
  userMessageId: string
  userId?: string
  assistantMessage?: PersistedMessage
  streamMarkerPolicy?: StreamMarkerPolicy
  runController?: { id: string; token: string }
  preferServerReplay?: boolean
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
 * message once for its turn, including user steering accepted within that turn.
 */
export async function finalizeAssistantTurn({
  chatId,
  userMessageId,
  userId,
  assistantMessage,
  streamMarkerPolicy = 'active-only',
  runController,
  preferServerReplay = false,
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

        if (runController) {
          const [run] = await tx
            .select({ id: copilotRuns.id })
            .from(copilotRuns)
            .where(
              and(
                eq(copilotRuns.id, runController.id),
                eq(copilotRuns.chatId, chatId),
                sql`${copilotRuns.requestContext}->>'controllerToken' = ${runController.token}`
              )
            )
            .limit(1)
          if (!run) throw new StreamControllerSupersededError()
        }

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

        /** Steering is another user message in the same turn. The turn's response identity,
         * rather than adjacency to its first message, determines whether it was answered. */
        const [lastMessage] = await tx
          .select({
            messageId: copilotMessages.messageId,
            role: copilotMessages.role,
            streamId: copilotMessages.streamId,
            hasResponse: sql<boolean>`EXISTS (SELECT 1 FROM ${copilotMessages} response
              WHERE response.chat_id = ${chatId} AND response.stream_id = ${userMessageId}
                AND response.role = 'assistant' AND response.deleted_at IS NULL)`,
          })
          .from(copilotMessages)
          .where(and(eq(copilotMessages.chatId, chatId), isNull(copilotMessages.deletedAt)))
          .orderBy(
            sql`${copilotMessages.seq} desc nulls last`,
            desc(copilotMessages.createdAt),
            desc(copilotMessages.id)
          )
          .limit(1)
        const alreadyHasResponse = lastMessage?.hasResponse || lastMessage?.role === 'assistant'
        const canAppendAssistant =
          !alreadyHasResponse &&
          lastMessage?.role === 'user' &&
          (lastMessage.messageId === userMessageId || lastMessage.streamId === userMessageId)

        const updateWhere = userId
          ? and(eq(copilotChats.id, chatId), eq(copilotChats.userId, userId))
          : eq(copilotChats.id, chatId)
        const baseUpdate = {
          conversationId: null,
          updatedAt: new Date(),
        }

        if (assistantMessage && canAppendAssistant) {
          let response = assistantMessage
          if (preferServerReplay) {
            const events = await readEvents(userMessageId, '0')
            /** StreamWriter starts at 1; Redis trims oldest events and skips corrupt entries. */
            const replayIsComplete =
              events.length > 0 && events.every((event, index) => event.seq === index + 1)
            const replay = replayIsComplete
              ? buildLiveAssistantMessage({
                  streamId: userMessageId,
                  events: events.map(toStreamBatchEvent),
                  status: 'cancelled',
                })
              : null
            /** A stopped client's snapshot may be empty; preserve canonical output before the first finalizer commits. */
            const replayHasContent =
              !!replay?.content.trim() ||
              replay?.contentBlocks?.some((block) => block.type !== 'complete')
            const partial =
              replay && replayHasContent ? { ...replay, id: assistantMessage.id } : assistantMessage
            response = withStoppedContentBlock({
              ...partial,
              content: redactSensitiveContent(partial.content),
              ...(partial.contentBlocks
                ? { contentBlocks: mergeAndRedactPersistedBlocks(partial.contentBlocks) }
                : {}),
            })
          }
          await tx.update(copilotChats).set(baseUpdate).where(updateWhere)
          await appendCopilotChatMessages(
            chatId,
            [response],
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
