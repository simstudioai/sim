import { createLogger } from '@sim/logger'
import { SIM_AGENT_API_URL_DEFAULT } from '@/lib/copilot/constants'
import { handleSubagentRouting, sseHandlers, subAgentHandlers } from '@/lib/copilot/orchestrator/sse-handlers'
import {
  normalizeSseEvent,
  shouldSkipToolCallEvent,
  shouldSkipToolResultEvent,
} from '@/lib/copilot/orchestrator/sse-utils'
import { parseSSEStream } from '@/lib/copilot/orchestrator/sse-parser'
import { prepareExecutionContext } from '@/lib/copilot/orchestrator/tool-executor'
import type {
  ExecutionContext,
  OrchestratorOptions,
  SSEEvent,
  StreamingContext,
  ToolCallSummary,
} from '@/lib/copilot/orchestrator/types'
import { env } from '@/lib/core/config/env'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'

const logger = createLogger('CopilotSubagentOrchestrator')
const SIM_AGENT_API_URL = env.SIM_AGENT_API_URL || SIM_AGENT_API_URL_DEFAULT

export interface SubagentOrchestratorOptions extends Omit<OrchestratorOptions, 'onComplete'> {
  userId: string
  workflowId?: string
  workspaceId?: string
  onComplete?: (result: SubagentOrchestratorResult) => void | Promise<void>
}

export interface SubagentOrchestratorResult {
  success: boolean
  content: string
  toolCalls: ToolCallSummary[]
  structuredResult?: {
    type?: string
    summary?: string
    data?: any
    success?: boolean
  }
  error?: string
  errors?: string[]
}

export async function orchestrateSubagentStream(
  agentId: string,
  requestPayload: Record<string, any>,
  options: SubagentOrchestratorOptions
): Promise<SubagentOrchestratorResult> {
  const { userId, workflowId, workspaceId, timeout = 300000, abortSignal } = options
  const execContext = await buildExecutionContext(userId, workflowId, workspaceId)

  const context: StreamingContext = {
    chatId: undefined,
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

  let structuredResult: SubagentOrchestratorResult['structuredResult']

  try {
    const response = await fetch(`${SIM_AGENT_API_URL}/api/subagent/${agentId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.COPILOT_API_KEY ? { 'x-api-key': env.COPILOT_API_KEY } : {}),
      },
      body: JSON.stringify({ ...requestPayload, stream: true, userId }),
      signal: abortSignal,
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(
        `Copilot backend error (${response.status}): ${errorText || response.statusText}`
      )
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

        const normalizedEvent = normalizeSseEvent(event)

        // Skip duplicate tool events to prevent state regressions.
        const shouldSkipToolCall = shouldSkipToolCallEvent(normalizedEvent)
        const shouldSkipToolResult = shouldSkipToolResultEvent(normalizedEvent)

        if (!shouldSkipToolCall && !shouldSkipToolResult) {
          await forwardEvent(normalizedEvent, options)
        }

        if (
          normalizedEvent.type === 'structured_result' ||
          normalizedEvent.type === 'subagent_result'
        ) {
          structuredResult = normalizeStructuredResult(normalizedEvent.data)
          context.streamComplete = true
          continue
        }

        // Handle subagent_start/subagent_end events to track nested subagent calls
        if (normalizedEvent.type === 'subagent_start') {
          const toolCallId = normalizedEvent.data?.tool_call_id
          if (toolCallId) {
            context.subAgentParentToolCallId = toolCallId
            context.subAgentContent[toolCallId] = ''
            context.subAgentToolCalls[toolCallId] = []
          }
          continue
        }

        if (normalizedEvent.type === 'subagent_end') {
          context.subAgentParentToolCallId = undefined
          continue
        }

        // For direct subagent calls, events may have the subagent field set (e.g., subagent: "discovery")
        // but no subagent_start event because this IS the top-level agent. Skip subagent routing
        // for events where the subagent field matches the current agentId - these are top-level events.
        const isTopLevelSubagentEvent =
          normalizedEvent.subagent === agentId && !context.subAgentParentToolCallId

        // Only route to subagent handlers for nested subagent events (not matching current agentId)
        if (!isTopLevelSubagentEvent && handleSubagentRouting(normalizedEvent, context)) {
          const handler = subAgentHandlers[normalizedEvent.type]
          if (handler) {
            await handler(normalizedEvent, context, execContext, options)
          }
          if (context.streamComplete) break
          continue
        }

        // Process as a regular SSE event (including top-level subagent events)
        const handler = sseHandlers[normalizedEvent.type]
        if (handler) {
          await handler(normalizedEvent, context, execContext, options)
        }
        if (context.streamComplete) break
      }
    } finally {
      clearTimeout(timeoutId)
    }

    const result = buildResult(context, structuredResult)
    await options.onComplete?.(result)
    return result
  } catch (error) {
    const err = error instanceof Error ? error : new Error('Subagent orchestration failed')
    logger.error('Subagent orchestration failed', { error: err.message, agentId })
    await options.onError?.(err)
    return {
      success: false,
      content: context.accumulatedContent,
      toolCalls: [],
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

function normalizeStructuredResult(data: any): SubagentOrchestratorResult['structuredResult'] {
  if (!data || typeof data !== 'object') {
    return undefined
  }
  return {
    type: data.result_type || data.type,
    summary: data.summary,
    data: data.data ?? data,
    success: data.success,
  }
}

async function buildExecutionContext(
  userId: string,
  workflowId?: string,
  workspaceId?: string
): Promise<ExecutionContext> {
  if (workflowId) {
    return prepareExecutionContext(userId, workflowId)
  }

  const decryptedEnvVars = await getEffectiveDecryptedEnv(userId, workspaceId)
  return {
    userId,
    workflowId: workflowId || '',
    workspaceId,
    decryptedEnvVars,
  }
}

function buildResult(
  context: StreamingContext,
  structuredResult?: SubagentOrchestratorResult['structuredResult']
): SubagentOrchestratorResult {
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
    success: context.errors.length === 0 && !context.wasAborted,
    content: context.accumulatedContent,
    toolCalls,
    structuredResult,
    errors: context.errors.length ? context.errors : undefined,
  }
}
