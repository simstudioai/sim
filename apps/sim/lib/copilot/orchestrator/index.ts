import { createLogger } from '@sim/logger'
import { SIM_AGENT_API_URL_DEFAULT } from '@/lib/copilot/constants'
import { env } from '@/lib/core/config/env'
import { parseSSEStream } from '@/lib/copilot/orchestrator/sse-parser'
import {
  handleSubagentRouting,
  sseHandlers,
  subAgentHandlers,
} from '@/lib/copilot/orchestrator/sse-handlers'
import { prepareExecutionContext } from '@/lib/copilot/orchestrator/tool-executor'
import type {
  ExecutionContext,
  OrchestratorOptions,
  OrchestratorResult,
  SSEEvent,
  StreamingContext,
  ToolCallSummary,
} from '@/lib/copilot/orchestrator/types'

const logger = createLogger('CopilotOrchestrator')
const SIM_AGENT_API_URL = env.SIM_AGENT_API_URL || SIM_AGENT_API_URL_DEFAULT

export interface OrchestrateStreamOptions extends OrchestratorOptions {
  userId: string
  workflowId: string
  chatId?: string
}

/**
 * Orchestrate a copilot SSE stream and execute tool calls server-side.
 */
export async function orchestrateCopilotStream(
  requestPayload: Record<string, any>,
  options: OrchestrateStreamOptions
): Promise<OrchestratorResult> {
  const { userId, workflowId, chatId, timeout = 300000, abortSignal } = options
  const execContext = await prepareExecutionContext(userId, workflowId)

  const context: StreamingContext = {
    chatId,
    conversationId: undefined,
    messageId: requestPayload?.messageId || crypto.randomUUID(),
    accumulatedContent: '',
    contentBlocks: [],
    toolCalls: new Map(),
    currentThinkingBlock: null,
    isInThinkingBlock: false,
    subAgentParentToolCallId: undefined,
    subAgentContent: {},
    subAgentToolCalls: {},
    pendingContent: '',
    streamComplete: false,
    wasAborted: false,
    errors: [],
  }

  try {
    const response = await fetch(`${SIM_AGENT_API_URL}/api/chat-completion-streaming`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.COPILOT_API_KEY ? { 'x-api-key': env.COPILOT_API_KEY } : {}),
      },
      body: JSON.stringify(requestPayload),
      signal: abortSignal,
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(`Copilot backend error (${response.status}): ${errorText || response.statusText}`)
    }

    if (!response.body) {
      throw new Error('Copilot backend response missing body')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()

    const timeoutId = setTimeout(() => {
      context.errors.push('Request timed out')
      context.streamComplete = true
      reader.cancel().catch(() => {})
    }, timeout)

    try {
      for await (const event of parseSSEStream(reader, decoder, abortSignal)) {
        if (abortSignal?.aborted) {
          context.wasAborted = true
          break
        }

        await forwardEvent(event, options)

        if (event.type === 'subagent_start') {
          const toolCallId = event.data?.tool_call_id
          if (toolCallId) {
            context.subAgentParentToolCallId = toolCallId
            context.subAgentContent[toolCallId] = ''
            context.subAgentToolCalls[toolCallId] = []
          }
          continue
        }

        if (event.type === 'subagent_end') {
          context.subAgentParentToolCallId = undefined
          continue
        }

        if (handleSubagentRouting(event, context)) {
          const handler = subAgentHandlers[event.type]
          if (handler) {
            await handler(event, context, execContext, options)
          }
          if (context.streamComplete) break
          continue
        }

        const handler = sseHandlers[event.type]
        if (handler) {
          await handler(event, context, execContext, options)
        }
        if (context.streamComplete) break
      }
    } finally {
      clearTimeout(timeoutId)
    }

    const result = buildResult(context)
    await options.onComplete?.(result)
    return result
  } catch (error) {
    const err = error instanceof Error ? error : new Error('Copilot orchestration failed')
    logger.error('Copilot orchestration failed', { error: err.message })
    await options.onError?.(err)
    return {
      success: false,
      content: '',
      contentBlocks: [],
      toolCalls: [],
      chatId: context.chatId,
      conversationId: context.conversationId,
      error: err.message,
    }
  }
}

async function forwardEvent(event: SSEEvent, options: OrchestratorOptions): Promise<void> {
  try {
    await options.onEvent?.(event)
  } catch (error) {
    logger.warn('Failed to forward SSE event', {
      type: event.type,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function buildResult(context: StreamingContext): OrchestratorResult {
  const toolCalls: ToolCallSummary[] = Array.from(context.toolCalls.values()).map((toolCall) => ({
    id: toolCall.id,
    name: toolCall.name,
    status: toolCall.status,
    params: toolCall.params,
    result: toolCall.result?.output,
    error: toolCall.error,
    durationMs:
      toolCall.endTime && toolCall.startTime ? toolCall.endTime - toolCall.startTime : undefined,
  }))

  return {
    success: context.errors.length === 0,
    content: context.accumulatedContent,
    contentBlocks: context.contentBlocks,
    toolCalls,
    chatId: context.chatId,
    conversationId: context.conversationId,
    errors: context.errors.length ? context.errors : undefined,
  }
}

