import { createLogger } from '@sim/logger'
import {
  TOOL_DECISION_INITIAL_POLL_MS,
  TOOL_DECISION_MAX_POLL_MS,
  TOOL_DECISION_POLL_BACKOFF,
} from '@/lib/copilot/constants'
import { INTERRUPT_TOOL_SET } from '@/lib/copilot/orchestrator/config'
import { getToolConfirmation } from '@/lib/copilot/orchestrator/persistence'
import {
  asRecord,
  markToolResultSeen,
  wasToolResultSeen,
} from '@/lib/copilot/orchestrator/sse-utils'
import { executeToolServerSide, markToolComplete } from '@/lib/copilot/orchestrator/tool-executor'
import type {
  ExecutionContext,
  OrchestratorOptions,
  SSEEvent,
  StreamingContext,
} from '@/lib/copilot/orchestrator/types'

const logger = createLogger('CopilotSseToolExecution')

export function isInterruptToolName(toolName: string): boolean {
  return INTERRUPT_TOOL_SET.has(toolName)
}

export async function executeToolAndReport(
  toolCallId: string,
  context: StreamingContext,
  execContext: ExecutionContext,
  options?: OrchestratorOptions
): Promise<void> {
  const toolCall = context.toolCalls.get(toolCallId)
  if (!toolCall) {
    logger.warn('[EXEC] toolCall not found in context map', { toolCallId })
    return
  }

  if (toolCall.status === 'executing') {
    logger.warn('[EXEC] toolCall already executing, skipping', { toolCallId, toolName: toolCall.name })
    return
  }
  if (wasToolResultSeen(toolCall.id)) {
    logger.warn('[EXEC] toolCall result already seen (dedup), skipping', { toolCallId, toolName: toolCall.name })
    return
  }

  logger.info('[EXEC] Starting tool execution', { toolCallId, toolName: toolCall.name, params: toolCall.params ? Object.keys(toolCall.params) : [] })
  toolCall.status = 'executing'
  try {
    const result = await executeToolServerSide(toolCall, execContext)
    logger.info('[EXEC] executeToolServerSide returned', {
      toolCallId,
      toolName: toolCall.name,
      success: result.success,
      hasOutput: !!result.output,
      error: result.error,
    })
    toolCall.status = result.success ? 'success' : 'error'
    toolCall.result = result
    toolCall.error = result.error
    toolCall.endTime = Date.now()

    // If create_workflow was successful, update the execution context with the new workflowId.
    // This ensures subsequent tools in the same stream have access to the workflowId.
    const output = asRecord(result.output)
    if (
      toolCall.name === 'create_workflow' &&
      result.success &&
      output.workflowId &&
      !execContext.workflowId
    ) {
      execContext.workflowId = output.workflowId as string
      if (output.workspaceId) {
        execContext.workspaceId = output.workspaceId as string
      }
    }

    markToolResultSeen(toolCall.id)

    // Fire-and-forget: notify the copilot backend that the tool completed.
    // IMPORTANT: We must NOT await this — the Go backend may block on the
    // mark-complete handler until it can write back on the SSE stream, but
    // the SSE reader (our for-await loop) is paused while we're in this
    // handler.  Awaiting here would deadlock: sim waits for Go's response,
    // Go waits for sim to drain the SSE stream.
    logger.info('[EXEC] Firing markToolComplete (fire-and-forget)', {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      status: result.success ? 200 : 500,
    })
    markToolComplete(
      toolCall.id,
      toolCall.name,
      result.success ? 200 : 500,
      result.error || (result.success ? 'Tool completed' : 'Tool failed'),
      result.output
    ).then((ok) => {
      logger.info('[EXEC] markToolComplete resolved', { toolCallId: toolCall.id, toolName: toolCall.name, ok })
    }).catch((err) => {
      logger.error('[EXEC] markToolComplete fire-and-forget FAILED', {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        error: err instanceof Error ? err.message : String(err),
      })
    })

    const resultEvent: SSEEvent = {
      type: 'tool_result',
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      success: result.success,
      result: result.output,
      data: {
        id: toolCall.id,
        name: toolCall.name,
        success: result.success,
        result: result.output,
      },
    }
    await options?.onEvent?.(resultEvent)
    logger.info('[EXEC] executeToolAndReport complete', { toolCallId, toolName: toolCall.name })
  } catch (error) {
    logger.error('[EXEC] executeToolAndReport CAUGHT ERROR', {
      toolCallId,
      toolName: toolCall.name,
      error: error instanceof Error ? error.message : String(error),
    })
    toolCall.status = 'error'
    toolCall.error = error instanceof Error ? error.message : String(error)
    toolCall.endTime = Date.now()

    markToolResultSeen(toolCall.id)

    // Fire-and-forget (same reasoning as above).
    markToolComplete(toolCall.id, toolCall.name, 500, toolCall.error).then((ok) => {
      logger.info('[EXEC] markToolComplete (error path) resolved', { toolCallId: toolCall.id, ok })
    }).catch((err) => {
      logger.error('[EXEC] markToolComplete (error path) FAILED', {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        error: err instanceof Error ? err.message : String(err),
      })
    })

    const errorEvent: SSEEvent = {
      type: 'tool_error',
      toolCallId: toolCall.id,
      data: {
        id: toolCall.id,
        name: toolCall.name,
        error: toolCall.error,
      },
    }
    await options?.onEvent?.(errorEvent)
  }
}

export async function waitForToolDecision(
  toolCallId: string,
  timeoutMs: number,
  abortSignal?: AbortSignal
): Promise<{ status: string; message?: string } | null> {
  const start = Date.now()
  let interval = TOOL_DECISION_INITIAL_POLL_MS
  const maxInterval = TOOL_DECISION_MAX_POLL_MS
  while (Date.now() - start < timeoutMs) {
    if (abortSignal?.aborted) return null
    const decision = await getToolConfirmation(toolCallId)
    if (decision?.status) {
      return decision
    }
    await new Promise((resolve) => setTimeout(resolve, interval))
    interval = Math.min(interval * TOOL_DECISION_POLL_BACKOFF, maxInterval)
  }
  return null
}
