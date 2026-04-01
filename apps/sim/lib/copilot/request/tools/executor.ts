import { createLogger } from '@sim/logger'
import {
  completeAsyncToolCall,
  markAsyncToolRunning,
  upsertAsyncToolCall,
} from '@/lib/copilot/async-runs/repository'
import {
  MothershipStreamV1AsyncToolRecordStatus,
  MothershipStreamV1EventType,
  MothershipStreamV1ToolExecutor,
  MothershipStreamV1ToolMode,
  MothershipStreamV1ToolOutcome,
  MothershipStreamV1ToolPhase,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { CreateWorkflow } from '@/lib/copilot/generated/tool-catalog-v1'
import { publishToolConfirmation } from '@/lib/copilot/persistence/tool-confirm'
import { asRecord, markToolResultSeen } from '@/lib/copilot/request/sse-utils'
import { maybeWriteOutputToFile } from '@/lib/copilot/request/tools/files'
import { handleResourceSideEffects } from '@/lib/copilot/request/tools/resources'
import {
  maybeWriteOutputToTable,
  maybeWriteReadCsvToTable,
} from '@/lib/copilot/request/tools/tables'
import {
  type ExecutionContext,
  isTerminalToolCallStatus,
  type OrchestratorOptions,
  type StreamEvent,
  type StreamingContext,
} from '@/lib/copilot/request/types'
import { ensureHandlersRegistered, executeTool } from '@/lib/copilot/tool-executor'

export { waitForToolCompletion } from '@/lib/copilot/request/tools/client'

const logger = createLogger('CopilotSseToolExecution')

export interface AsyncToolCompletion {
  status: string
  message?: string
  data?: Record<string, unknown>
}

function publishTerminalToolConfirmation(input: {
  toolCallId: string
  status: string
  message?: string
  data?: Record<string, unknown>
}): void {
  publishToolConfirmation({
    toolCallId: input.toolCallId,
    status: input.status,
    message: input.message,
    data: input.data,
    timestamp: new Date().toISOString(),
  })
}

function abortRequested(
  context: StreamingContext,
  execContext: ExecutionContext,
  options?: OrchestratorOptions
): boolean {
  return Boolean(
    options?.abortSignal?.aborted || execContext.abortSignal?.aborted || context.wasAborted
  )
}

function cancelledCompletion(message: string): AsyncToolCompletion {
  return {
    status: MothershipStreamV1ToolOutcome.cancelled,
    message,
    data: { cancelled: true },
  }
}

function terminalCompletionFromToolCall(toolCall: {
  status: string
  error?: string
  result?: { output?: unknown; error?: string }
}): AsyncToolCompletion {
  if (toolCall.status === MothershipStreamV1ToolOutcome.cancelled) {
    return cancelledCompletion(toolCall.error || 'Tool execution cancelled')
  }

  if (toolCall.status === MothershipStreamV1ToolOutcome.success) {
    return {
      status: MothershipStreamV1ToolOutcome.success,
      message: 'Tool completed',
      data:
        toolCall.result?.output &&
        typeof toolCall.result.output === 'object' &&
        !Array.isArray(toolCall.result.output)
          ? (toolCall.result.output as Record<string, unknown>)
          : undefined,
    }
  }

  if (toolCall.status === MothershipStreamV1ToolOutcome.skipped) {
    return {
      status: MothershipStreamV1ToolOutcome.success,
      message: 'Tool skipped',
      data:
        toolCall.result?.output &&
        typeof toolCall.result.output === 'object' &&
        !Array.isArray(toolCall.result.output)
          ? (toolCall.result.output as Record<string, unknown>)
          : undefined,
    }
  }

  return {
    status:
      toolCall.status === MothershipStreamV1ToolOutcome.rejected
        ? MothershipStreamV1ToolOutcome.rejected
        : MothershipStreamV1ToolOutcome.error,
    message: toolCall.error || toolCall.result?.error || 'Tool failed',
    data: { error: toolCall.error || toolCall.result?.error || 'Tool failed' },
  }
}

export async function executeToolAndReport(
  toolCallId: string,
  context: StreamingContext,
  execContext: ExecutionContext,
  options?: OrchestratorOptions
): Promise<AsyncToolCompletion> {
  const toolCall = context.toolCalls.get(toolCallId)
  if (!toolCall)
    return { status: MothershipStreamV1ToolOutcome.error, message: 'Tool call not found' }

  if (toolCall.status === 'executing') {
    return {
      status: MothershipStreamV1AsyncToolRecordStatus.running,
      message: 'Tool already executing',
    }
  }
  if (toolCall.endTime || isTerminalToolCallStatus(toolCall.status)) {
    return terminalCompletionFromToolCall(toolCall)
  }

  if (abortRequested(context, execContext, options)) {
    toolCall.status = MothershipStreamV1ToolOutcome.cancelled
    toolCall.endTime = Date.now()
    markToolResultSeen(toolCall.id)
    await completeAsyncToolCall({
      toolCallId: toolCall.id,
      status: MothershipStreamV1AsyncToolRecordStatus.cancelled,
      result: { cancelled: true },
      error: 'Request aborted before tool execution',
    }).catch((err) => {
      logger.warn('Failed to persist async tool status', {
        toolCallId: toolCall.id,
        error: err instanceof Error ? err.message : String(err),
      })
    })
    publishTerminalToolConfirmation({
      toolCallId: toolCall.id,
      status: MothershipStreamV1ToolOutcome.cancelled,
      message: 'Request aborted before tool execution',
      data: { cancelled: true },
    })
    return cancelledCompletion('Request aborted before tool execution')
  }

  toolCall.status = 'executing'
  await upsertAsyncToolCall({
    runId: context.runId || crypto.randomUUID(),
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    args: toolCall.params,
  }).catch((err) => {
    logger.warn('Failed to persist async tool row before execution', {
      toolCallId: toolCall.id,
      error: err instanceof Error ? err.message : String(err),
    })
  })
  await markAsyncToolRunning(toolCall.id, 'sim-stream').catch((err) => {
    logger.warn('Failed to mark async tool running', {
      toolCallId: toolCall.id,
      error: err instanceof Error ? err.message : String(err),
    })
  })

  if (toolCall.endTime || isTerminalToolCallStatus(toolCall.status)) {
    return terminalCompletionFromToolCall(toolCall)
  }

  const argsPreview = toolCall.params ? JSON.stringify(toolCall.params).slice(0, 200) : undefined
  const toolSpan = context.trace.startSpan(toolCall.name, 'tool.execute', {
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    argsPreview,
  })

  logger.info('Tool execution started', {
    toolCallId: toolCall.id,
    toolName: toolCall.name,
  })

  try {
    ensureHandlersRegistered()
    let result = await executeTool(toolCall.name, toolCall.params || {}, execContext)
    if (toolCall.endTime || isTerminalToolCallStatus(toolCall.status)) {
      return terminalCompletionFromToolCall(toolCall)
    }
    if (abortRequested(context, execContext, options)) {
      toolCall.status = MothershipStreamV1ToolOutcome.cancelled
      toolCall.endTime = Date.now()
      markToolResultSeen(toolCall.id)
      await completeAsyncToolCall({
        toolCallId: toolCall.id,
        status: MothershipStreamV1AsyncToolRecordStatus.cancelled,
        result: { cancelled: true },
        error: 'Request aborted during tool execution',
      }).catch((err) => {
        logger.warn('Failed to persist async tool status', {
          toolCallId: toolCall.id,
          error: err instanceof Error ? err.message : String(err),
        })
      })
      publishTerminalToolConfirmation({
        toolCallId: toolCall.id,
        status: MothershipStreamV1ToolOutcome.cancelled,
        message: 'Request aborted during tool execution',
        data: { cancelled: true },
      })
      return cancelledCompletion('Request aborted during tool execution')
    }
    result = await maybeWriteOutputToFile(toolCall.name, toolCall.params, result, execContext)
    if (abortRequested(context, execContext, options)) {
      toolCall.status = MothershipStreamV1ToolOutcome.cancelled
      toolCall.endTime = Date.now()
      markToolResultSeen(toolCall.id)
      await completeAsyncToolCall({
        toolCallId: toolCall.id,
        status: MothershipStreamV1AsyncToolRecordStatus.cancelled,
        result: { cancelled: true },
        error: 'Request aborted during tool post-processing',
      }).catch((err) => {
        logger.warn('Failed to persist async tool status', {
          toolCallId: toolCall.id,
          error: err instanceof Error ? err.message : String(err),
        })
      })
      publishTerminalToolConfirmation({
        toolCallId: toolCall.id,
        status: MothershipStreamV1ToolOutcome.cancelled,
        message: 'Request aborted during tool post-processing',
        data: { cancelled: true },
      })
      return cancelledCompletion('Request aborted during tool post-processing')
    }
    result = await maybeWriteOutputToTable(toolCall.name, toolCall.params, result, execContext)
    if (abortRequested(context, execContext, options)) {
      toolCall.status = MothershipStreamV1ToolOutcome.cancelled
      toolCall.endTime = Date.now()
      markToolResultSeen(toolCall.id)
      await completeAsyncToolCall({
        toolCallId: toolCall.id,
        status: MothershipStreamV1AsyncToolRecordStatus.cancelled,
        result: { cancelled: true },
        error: 'Request aborted during tool post-processing',
      }).catch((err) => {
        logger.warn('Failed to persist async tool status', {
          toolCallId: toolCall.id,
          error: err instanceof Error ? err.message : String(err),
        })
      })
      publishTerminalToolConfirmation({
        toolCallId: toolCall.id,
        status: MothershipStreamV1ToolOutcome.cancelled,
        message: 'Request aborted during tool post-processing',
        data: { cancelled: true },
      })
      return cancelledCompletion('Request aborted during tool post-processing')
    }
    result = await maybeWriteReadCsvToTable(toolCall.name, toolCall.params, result, execContext)
    if (abortRequested(context, execContext, options)) {
      toolCall.status = MothershipStreamV1ToolOutcome.cancelled
      toolCall.endTime = Date.now()
      markToolResultSeen(toolCall.id)
      await completeAsyncToolCall({
        toolCallId: toolCall.id,
        status: MothershipStreamV1AsyncToolRecordStatus.cancelled,
        result: { cancelled: true },
        error: 'Request aborted during tool post-processing',
      }).catch((err) => {
        logger.warn('Failed to persist async tool status', {
          toolCallId: toolCall.id,
          error: err instanceof Error ? err.message : String(err),
        })
      })
      publishTerminalToolConfirmation({
        toolCallId: toolCall.id,
        status: MothershipStreamV1ToolOutcome.cancelled,
        message: 'Request aborted during tool post-processing',
        data: { cancelled: true },
      })
      return cancelledCompletion('Request aborted during tool post-processing')
    }
    toolCall.status = result.success
      ? MothershipStreamV1ToolOutcome.success
      : MothershipStreamV1ToolOutcome.error
    toolCall.result = result
    toolCall.error = result.error
    toolCall.endTime = Date.now()

    if (result.success) {
      const raw = result.output
      const preview =
        typeof raw === 'string'
          ? raw.slice(0, 200)
          : raw && typeof raw === 'object'
            ? JSON.stringify(raw).slice(0, 200)
            : undefined
      logger.info('Tool execution succeeded', {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        outputPreview: preview,
      })
    } else {
      logger.warn('Tool execution failed', {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        error: result.error,
        params: toolCall.params,
      })
    }

    // If create_workflow was successful, update the execution context with the new workflowId.
    // This ensures subsequent tools in the same stream have access to the workflowId.
    const output = asRecord(result.output)
    if (
      toolCall.name === CreateWorkflow.id &&
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
    await completeAsyncToolCall({
      toolCallId: toolCall.id,
      status: result.success
        ? MothershipStreamV1AsyncToolRecordStatus.completed
        : MothershipStreamV1AsyncToolRecordStatus.failed,
      result: result.success ? asRecord(result.output) : { error: result.error || 'Tool failed' },
      error: result.success ? null : result.error || 'Tool failed',
    }).catch((err) => {
      logger.warn('Failed to persist async tool completion', {
        toolCallId: toolCall.id,
        error: err instanceof Error ? err.message : String(err),
      })
    })
    publishTerminalToolConfirmation({
      toolCallId: toolCall.id,
      status: result.success
        ? MothershipStreamV1ToolOutcome.success
        : MothershipStreamV1ToolOutcome.error,
      message: result.error || (result.success ? 'Tool completed' : 'Tool failed'),
      data: asRecord(result.output),
    })

    if (abortRequested(context, execContext, options)) {
      toolCall.status = MothershipStreamV1ToolOutcome.cancelled
      return cancelledCompletion('Request aborted before tool result delivery')
    }

    // Fire-and-forget: notify the copilot backend that the tool completed.
    // IMPORTANT: We must NOT await this — the Go backend may block on the
    const resultEvent: StreamEvent = {
      type: MothershipStreamV1EventType.tool,
      payload: {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        executor: MothershipStreamV1ToolExecutor.sim,
        mode: MothershipStreamV1ToolMode.async,
        phase: MothershipStreamV1ToolPhase.result,
        success: result.success,
        result: result.output,
        ...(result.success
          ? { status: MothershipStreamV1ToolOutcome.success }
          : { status: MothershipStreamV1ToolOutcome.error }),
      },
    }
    await options?.onEvent?.(resultEvent)

    if (abortRequested(context, execContext, options)) {
      toolCall.status = MothershipStreamV1ToolOutcome.cancelled
      return cancelledCompletion('Request aborted before resource persistence')
    }

    if (result.success && execContext.chatId && !abortRequested(context, execContext, options)) {
      await handleResourceSideEffects(
        toolCall.name,
        toolCall.params,
        result,
        execContext.chatId,
        options?.onEvent,
        () => abortRequested(context, execContext, options)
      )
    }
    context.trace.endSpan(toolSpan, result.success ? 'ok' : 'error')
    return {
      status: result.success
        ? MothershipStreamV1ToolOutcome.success
        : MothershipStreamV1ToolOutcome.error,
      message: result.error || (result.success ? 'Tool completed' : 'Tool failed'),
      data: asRecord(result.output),
    }
  } catch (error) {
    context.trace.endSpan(toolSpan, 'error')
    if (abortRequested(context, execContext, options)) {
      toolCall.status = MothershipStreamV1ToolOutcome.cancelled
      toolCall.endTime = Date.now()
      markToolResultSeen(toolCall.id)
      await completeAsyncToolCall({
        toolCallId: toolCall.id,
        status: MothershipStreamV1AsyncToolRecordStatus.cancelled,
        result: { cancelled: true },
        error: 'Request aborted during tool execution',
      }).catch((err) => {
        logger.warn('Failed to persist async tool status', {
          toolCallId: toolCall.id,
          error: err instanceof Error ? err.message : String(err),
        })
      })
      publishTerminalToolConfirmation({
        toolCallId: toolCall.id,
        status: MothershipStreamV1ToolOutcome.cancelled,
        message: 'Request aborted during tool execution',
        data: { cancelled: true },
      })
      return cancelledCompletion('Request aborted during tool execution')
    }
    toolCall.status = MothershipStreamV1ToolOutcome.error
    toolCall.error = error instanceof Error ? error.message : String(error)
    toolCall.endTime = Date.now()

    logger.error('Tool execution threw', {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      error: toolCall.error,
      params: toolCall.params,
    })

    markToolResultSeen(toolCall.id)
    await completeAsyncToolCall({
      toolCallId: toolCall.id,
      status: MothershipStreamV1AsyncToolRecordStatus.failed,
      result: { error: toolCall.error },
      error: toolCall.error,
    }).catch((err) => {
      logger.warn('Failed to persist async tool error', {
        toolCallId: toolCall.id,
        error: err instanceof Error ? err.message : String(err),
      })
    })
    publishTerminalToolConfirmation({
      toolCallId: toolCall.id,
      status: MothershipStreamV1ToolOutcome.error,
      message: toolCall.error,
      data: { error: toolCall.error },
    })

    const errorEvent: StreamEvent = {
      type: MothershipStreamV1EventType.tool,
      payload: {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        executor: MothershipStreamV1ToolExecutor.sim,
        mode: MothershipStreamV1ToolMode.async,
        phase: MothershipStreamV1ToolPhase.result,
        status: MothershipStreamV1ToolOutcome.error,
        error: toolCall.error,
        result: { error: toolCall.error },
      },
    }
    await options?.onEvent?.(errorEvent)
    return {
      status: MothershipStreamV1ToolOutcome.error,
      message: toolCall.error,
      data: { error: toolCall.error },
    }
  }
}
