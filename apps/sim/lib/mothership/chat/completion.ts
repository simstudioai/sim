import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  buildPersistedAssistantMessage,
  withStoppedContentBlock,
} from '@/lib/mothership/chat/persisted-message'
import { finalizeAssistantTurn } from '@/lib/mothership/chat/terminal-state'
import { chatPubSub } from '@/lib/mothership/chat-status'
import { CopilotChatFinalizeOutcome } from '@/lib/mothership/generated/trace-attribute-values-v1'
import { StreamControllerSupersededError } from '@/lib/mothership/request/session/controller-lease'
import type { OrchestratorResult } from '@/lib/mothership/request/types'

const logger = createLogger('CopilotChatCompletion')

export function buildOnComplete(params: {
  chatId?: string
  userMessageId: string
  requestId: string
  workspaceId?: string
  notifyWorkspaceStatus: boolean
  runController?: { id: string; token: string }
  /**
   * Root agent span for this request. When present, the final
   * assistant message + invoked tool calls are recorded as
   * `gen_ai.output.messages` on it before persistence runs. Keeps
   * the Honeycomb Gen AI view complete across both the Sim root
   * span and the Go-side `llm.stream` spans.
   */
  otelRoot?: {
    setOutputMessages: (output: {
      assistantText?: string
      toolCalls?: Array<{ id: string; name: string; arguments?: Record<string, unknown> }>
    }) => void
  }
}) {
  const {
    chatId,
    userMessageId,
    requestId,
    workspaceId,
    notifyWorkspaceStatus,
    otelRoot,
    runController,
  } = params

  return async (result: OrchestratorResult) => {
    if (otelRoot && result.success) {
      otelRoot.setOutputMessages({
        assistantText: result.content,
        toolCalls: result.toolCalls?.map((tc) => ({
          id: tc.id,
          name: tc.name,
          arguments: tc.params,
        })),
      })
    }

    if (!chatId) return

    try {
      if (result.cancelled) {
        const finalization = await finalizeAssistantTurn({
          runController,
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

      // On a non-success terminal (e.g. a transient provider error like
      // "overloaded"), persist whatever streamed before the failure — same as
      // the cancelled path — instead of dropping the partial assistant output.
      const assistantMessage = buildPersistedAssistantMessage(result, requestId)
      const hasPartial =
        !!assistantMessage.content?.trim() || (assistantMessage.contentBlocks?.length ?? 0) > 0
      await finalizeAssistantTurn({
        runController,
        chatId,
        userMessageId,
        ...(result.success || hasPartial ? { assistantMessage } : {}),
        // Match the cancelled path so the partial still persists if onError
        // raced ahead and already cleared the stream marker.
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
      if (error instanceof StreamControllerSupersededError) throw error
      logger.error(`[${requestId}] Failed to persist chat messages`, {
        chatId,
        error: getErrorMessage(error, 'Unknown error'),
      })
    }
  }
}

export function buildOnError(params: {
  chatId?: string
  userMessageId: string
  requestId: string
  workspaceId?: string
  notifyWorkspaceStatus: boolean
  runController?: { id: string; token: string }
}) {
  const { chatId, userMessageId, requestId, workspaceId, notifyWorkspaceStatus, runController } =
    params

  return async (error: Error, result?: OrchestratorResult) => {
    if (!chatId) return

    try {
      // Persist whatever streamed before a thrown backend error, mirroring the
      // cancelled / non-success completion path, so the partial assistant turn
      // (text + tool calls + subagent work) survives the refetch instead of the
      // chat collapsing to an empty assistant row.
      const assistantMessage = buildPersistedAssistantMessage(
        {
          content: '',
          contentBlocks: [],
          toolCalls: [],
          ...result,
          success: false,
          error: result?.error || getErrorMessage(error),
        },
        requestId
      )
      await finalizeAssistantTurn({
        runController,
        chatId,
        userMessageId,
        assistantMessage,
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
      if (error instanceof StreamControllerSupersededError) throw error
      logger.error(`[${requestId}] Failed to finalize errored chat stream`, {
        chatId,
        error: getErrorMessage(error, 'Unknown error'),
      })
    }
  }
}
