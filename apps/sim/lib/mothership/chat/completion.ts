import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { remarkAppliedSteeringMessage } from '@/lib/mothership/chat/messages-store'
import {
  buildPersistedAssistantMessage,
  withStoppedContentBlock,
} from '@/lib/mothership/chat/persisted-message'
import { finalizeAssistantTurn } from '@/lib/mothership/chat/terminal-state'
import { publishChatStatusChanged } from '@/lib/mothership/chat-status'
import { CopilotChatFinalizeOutcome } from '@/lib/mothership/generated/trace-attribute-values-v1'
import { StreamControllerSupersededError } from '@/lib/mothership/request/session/controller-lease'
import type { OrchestratorResult } from '@/lib/mothership/request/types'

const logger = createLogger('CopilotChatCompletion')

/**
 * Ends a turn the worker refused because a run of the chat already applied its
 * message as steering (`input_applied`): nothing ran, so no answer or error is
 * stored. The admitted message goes back to being that steering record, so the
 * transcript shows it once, where the run applied it.
 */
async function settleAppliedInputTurn(params: {
  runController?: { id: string; token: string }
  chatId: string
  userMessageId: string
  notifyChatStatus: boolean
  workspaceId?: string
  organizationId?: string
  userId?: string
}): Promise<void> {
  const { runController, chatId, userMessageId, workspaceId, organizationId, userId } = params
  await remarkAppliedSteeringMessage(chatId, userMessageId)
  await finalizeAssistantTurn({
    runController,
    chatId,
    userMessageId,
    streamMarkerPolicy: 'active-or-cleared',
  })
  if (params.notifyChatStatus) {
    publishChatStatusChanged(
      { workspaceId, organizationId, userId },
      { chatId, type: 'completed', streamId: userMessageId }
    )
  }
}

export function buildOnComplete(params: {
  chatId?: string
  userMessageId: string
  requestId: string
  workspaceId?: string
  notifyChatStatus?: boolean
  notifyWorkspaceStatus?: boolean
  runController?: { id: string; token: string }
  organizationId?: string
  userId?: string
  requestMode?: 'assistant' | 'agent' | 'plan'
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
    organizationId,
    userId,
    runController,
    otelRoot,
  } = params
  const notifyChatStatus = params.notifyChatStatus ?? params.notifyWorkspaceStatus ?? false

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
      if (result.inputApplied) {
        await settleAppliedInputTurn({
          runController,
          chatId,
          userMessageId,
          notifyChatStatus,
          workspaceId,
          organizationId,
          userId,
        })
        return
      }
      if (result.cancelled) {
        const finalization = await finalizeAssistantTurn({
          runController,
          chatId,
          userMessageId,
          assistantMessage: withStoppedContentBlock(
            buildPersistedAssistantMessage(result, requestId, params.requestMode)
          ),
          streamMarkerPolicy: 'active-or-cleared',
        })
        const shouldPublishCompletion =
          finalization.updated ||
          finalization.outcome === CopilotChatFinalizeOutcome.AssistantAlreadyPersisted

        if (notifyChatStatus && shouldPublishCompletion) {
          publishChatStatusChanged(
            { workspaceId, organizationId, userId },
            {
              chatId,
              type: 'completed',
              streamId: userMessageId,
            }
          )
        }
        return
      }

      // On a non-success terminal (e.g. a transient provider error like
      // "overloaded"), persist whatever streamed before the failure — same as
      // the cancelled path — instead of dropping the partial assistant output.
      const assistantMessage = buildPersistedAssistantMessage(result, requestId, params.requestMode)
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

      if (notifyChatStatus) {
        publishChatStatusChanged(
          { workspaceId, organizationId, userId },
          {
            chatId,
            type: 'completed',
            streamId: userMessageId,
          }
        )
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
  notifyChatStatus?: boolean
  notifyWorkspaceStatus?: boolean
  runController?: { id: string; token: string }
  organizationId?: string
  userId?: string
  requestMode?: 'assistant' | 'agent' | 'plan'
}) {
  const { chatId, userMessageId, requestId, workspaceId, organizationId, userId, runController } =
    params
  const notifyChatStatus = params.notifyChatStatus ?? params.notifyWorkspaceStatus ?? false

  return async (error: Error, result?: OrchestratorResult) => {
    if (!chatId) return

    try {
      if (result?.inputApplied) {
        await settleAppliedInputTurn({
          runController,
          chatId,
          userMessageId,
          notifyChatStatus,
          workspaceId,
          organizationId,
          userId,
        })
        return
      }
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
        requestId,
        params.requestMode
      )
      await finalizeAssistantTurn({
        runController,
        chatId,
        userMessageId,
        assistantMessage,
        streamMarkerPolicy: 'active-or-cleared',
      })

      if (notifyChatStatus) {
        publishChatStatusChanged(
          { workspaceId, organizationId, userId },
          {
            chatId,
            type: 'completed',
            streamId: userMessageId,
          }
        )
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
