import type { Context as OtelContext } from '@opentelemetry/api'
import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { eq } from 'drizzle-orm'
import { appendCopilotChatMessages } from '@/lib/copilot/chat/messages-store'
import {
  buildPersistedAssistantMessage,
  buildPersistedUserMessage,
  type UserMessageParams,
  withStoppedContentBlock,
} from '@/lib/copilot/chat/persisted-message'
import { finalizeAssistantTurn } from '@/lib/copilot/chat/terminal-state'
import { chatPubSub } from '@/lib/copilot/chat-status'
import {
  CopilotChatFinalizeOutcome,
  CopilotChatPersistOutcome,
} from '@/lib/copilot/generated/trace-attribute-values-v1'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { TraceSpan } from '@/lib/copilot/generated/trace-spans-v1'
import { withCopilotSpan } from '@/lib/copilot/request/otel'
import type { OrchestratorResult } from '@/lib/copilot/request/types'

const logger = createLogger('CopilotTurnPersistence')

export interface PersistCopilotUserMessageParams {
  chatId?: string
  userMessageId: string
  message: string
  fileAttachments?: UserMessageParams['fileAttachments']
  contexts?: UserMessageParams['contexts']
  workspaceId?: string
  notifyWorkspaceStatus: boolean
  /**
   * Root context for the mothership request. When present the persist span is
   * created explicitly under it instead of relying on ambient propagation.
   */
  parentOtelContext?: OtelContext
}

/** Persists the user half of a chat turn and marks that turn as active. */
export async function persistCopilotUserMessage({
  chatId,
  userMessageId,
  message,
  fileAttachments,
  contexts,
  workspaceId,
  notifyWorkspaceStatus,
  parentOtelContext,
}: PersistCopilotUserMessageParams): Promise<void> {
  if (!chatId) return

  return withCopilotSpan(
    TraceSpan.CopilotChatPersistUserMessage,
    {
      [TraceAttr.DbSystem]: 'postgresql',
      [TraceAttr.DbSqlTable]: 'copilot_chats',
      [TraceAttr.ChatId]: chatId,
      [TraceAttr.ChatUserMessageId]: userMessageId,
      [TraceAttr.ChatMessageBytes]: message.length,
      [TraceAttr.ChatFileAttachmentCount]: fileAttachments?.length ?? 0,
      [TraceAttr.ChatContextCount]: contexts?.length ?? 0,
      ...(workspaceId ? { [TraceAttr.WorkspaceId]: workspaceId } : {}),
    },
    async (span) => {
      const userMessage = buildPersistedUserMessage({
        id: userMessageId,
        content: message,
        fileAttachments,
        contexts,
      })

      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(copilotChats)
          .set({
            conversationId: userMessageId,
            updatedAt: new Date(),
          })
          .where(eq(copilotChats.id, chatId))
          .returning({ model: copilotChats.model })

        if (!row) return null

        await appendCopilotChatMessages(
          chatId,
          [userMessage],
          { streamId: userMessageId, chatModel: row.model ?? null },
          tx
        )
        return row
      })

      span.setAttribute(
        TraceAttr.ChatPersistOutcome,
        updated ? CopilotChatPersistOutcome.Appended : CopilotChatPersistOutcome.ChatNotFound
      )

      if (notifyWorkspaceStatus && updated && workspaceId) {
        chatPubSub?.publishStatusChanged({
          workspaceId,
          chatId,
          type: 'started',
          streamId: userMessageId,
        })
      }
    },
    parentOtelContext
  )
}

interface CopilotTurnTerminalParams {
  chatId?: string
  userMessageId: string
  requestId: string
  workspaceId?: string
  notifyWorkspaceStatus: boolean
}

export interface BuildCopilotTurnOnCompleteParams extends CopilotTurnTerminalParams {
  /** Records the terminal model output on an optional caller-owned root span. */
  otelRoot?: {
    setOutputMessages: (output: {
      assistantText?: string
      toolCalls?: Array<{ id: string; name: string; arguments?: Record<string, unknown> }>
    }) => void
  }
}

/** Builds the shared successful/cancelled turn persistence callback. */
export function buildCopilotTurnOnComplete({
  chatId,
  userMessageId,
  requestId,
  workspaceId,
  notifyWorkspaceStatus,
  otelRoot,
}: BuildCopilotTurnOnCompleteParams) {
  return async (result: OrchestratorResult): Promise<void> => {
    if (otelRoot && result.success) {
      otelRoot.setOutputMessages({
        assistantText: result.content,
        toolCalls: result.toolCalls?.map((toolCall) => ({
          id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.params,
        })),
      })
    }

    if (!chatId) return

    try {
      if (result.cancelled) {
        const finalization = await finalizeAssistantTurn({
          chatId,
          userMessageId,
          assistantMessage: withStoppedContentBlock(
            buildPersistedAssistantMessage(result, requestId)
          ),
          streamMarkerPolicy: 'active-or-cleared',
        })
        const shouldPublishCompletion =
          finalization.updated ||
          finalization.outcome === CopilotChatFinalizeOutcome.AssistantAlreadyPersisted

        if (notifyWorkspaceStatus && workspaceId && shouldPublishCompletion) {
          chatPubSub?.publishStatusChanged({
            workspaceId,
            chatId,
            type: 'completed',
            streamId: userMessageId,
          })
        }
        return
      }

      const assistantMessage = buildPersistedAssistantMessage(result, requestId)
      const hasPartial =
        !!assistantMessage.content?.trim() || (assistantMessage.contentBlocks?.length ?? 0) > 0
      await finalizeAssistantTurn({
        chatId,
        userMessageId,
        ...(result.success || hasPartial ? { assistantMessage } : {}),
        ...(result.success ? {} : { streamMarkerPolicy: 'active-or-cleared' as const }),
      })

      if (notifyWorkspaceStatus && workspaceId) {
        chatPubSub?.publishStatusChanged({
          workspaceId,
          chatId,
          type: 'completed',
          streamId: userMessageId,
        })
      }
    } catch (error) {
      logger.error(`[${requestId}] Failed to persist chat messages`, {
        chatId,
        error: getErrorMessage(error, 'Unknown error'),
      })
    }
  }
}

/** Builds the shared thrown-error turn persistence callback. */
export function buildCopilotTurnOnError({
  chatId,
  userMessageId,
  requestId,
  workspaceId,
  notifyWorkspaceStatus,
}: CopilotTurnTerminalParams) {
  return async (_error: Error, result?: OrchestratorResult): Promise<void> => {
    if (!chatId) return

    try {
      const assistantMessage = result
        ? buildPersistedAssistantMessage(result, requestId)
        : undefined
      const hasPartial =
        !!assistantMessage?.content?.trim() || (assistantMessage?.contentBlocks?.length ?? 0) > 0
      await finalizeAssistantTurn({
        chatId,
        userMessageId,
        ...(hasPartial ? { assistantMessage } : {}),
        streamMarkerPolicy: 'active-or-cleared',
      })

      if (notifyWorkspaceStatus && workspaceId) {
        chatPubSub?.publishStatusChanged({
          workspaceId,
          chatId,
          type: 'completed',
          streamId: userMessageId,
        })
      }
    } catch (error) {
      logger.error(`[${requestId}] Failed to finalize errored chat stream`, {
        chatId,
        error: getErrorMessage(error, 'Unknown error'),
      })
    }
  }
}
