import { createLogger } from '@sim/logger'
import { upsertAsyncToolCall } from '@/lib/copilot/async-runs/repository'
import { STREAM_TIMEOUT_MS } from '@/lib/copilot/constants'
import {
  asRecord,
  getEventData,
  markToolResultSeen,
  wasToolResultSeen,
} from '@/lib/copilot/orchestrator/sse/utils'
import {
  isToolAvailableOnSimSide,
  markToolComplete,
} from '@/lib/copilot/orchestrator/tool-executor'
import type {
  ContentBlock,
  ExecutionContext,
  OrchestratorOptions,
  SSEEvent,
  StreamingContext,
  ToolCallState,
} from '@/lib/copilot/orchestrator/types'
import { isWorkflowToolName } from '@/lib/copilot/workflow-tools'
import { generateId } from '@/lib/core/utils/uuid'
import { executeToolAndReport, waitForToolCompletion } from './tool-execution'

const logger = createLogger('CopilotSseHandlers')

/**
 * Builds an AbortSignal that fires when either the main abort signal OR
 * the client-disconnect signal fires. Used for client-executable tool waits
 * so the orchestrator doesn't block for the full timeout when the browser dies.
 */
function buildClientToolAbortSignal(options: OrchestratorOptions): AbortSignal | undefined {
  const { abortSignal, clientDisconnectedSignal } = options
  if (!clientDisconnectedSignal || clientDisconnectedSignal.aborted) {
    return clientDisconnectedSignal?.aborted ? AbortSignal.abort() : abortSignal
  }
  if (!abortSignal) return clientDisconnectedSignal

  const combined = new AbortController()
  const fire = () => combined.abort()
  abortSignal.addEventListener('abort', fire, { once: true })
  clientDisconnectedSignal.addEventListener('abort', fire, { once: true })
  return combined.signal
}

function registerPendingToolPromise(
  context: StreamingContext,
  toolCallId: string,
  pendingPromise: Promise<{ status: string; message?: string; data?: Record<string, unknown> }>
) {
  context.pendingToolPromises.set(toolCallId, pendingPromise)
  pendingPromise.finally(() => {
    if (context.pendingToolPromises.get(toolCallId) === pendingPromise) {
      context.pendingToolPromises.delete(toolCallId)
    }
  })
}

/**
 * When the Sim→Go stream is aborted, avoid starting server-side tool work and
 * unblock the Go async waiter with a terminal 499 completion.
 */
function abortPendingToolIfStreamDead(
  toolCall: ToolCallState,
  toolCallId: string,
  options: OrchestratorOptions,
  context: StreamingContext
): boolean {
  if (!options.abortSignal?.aborted && !context.wasAborted) {
    return false
  }
  toolCall.status = 'cancelled'
  toolCall.endTime = Date.now()
  markToolResultSeen(toolCallId)
  markToolComplete(
    toolCall.id,
    toolCall.name,
    499,
    'Request aborted before tool execution',
    {
      cancelled: true,
    },
    context.messageId
  ).catch((err) => {
    logger
      .withMetadata({ messageId: context.messageId })
      .error('markToolComplete fire-and-forget failed (stream aborted)', {
        toolCallId: toolCall.id,
        error: err instanceof Error ? err.message : String(err),
      })
  })
  return true
}

/**
 * Extract the `ui` object from an SSE event. The server enriches
 * tool_call events with `ui: { requiresConfirmation, clientExecutable, ... }`.
 */
function getEventUI(event: SSEEvent): {
  requiresConfirmation: boolean
  clientExecutable: boolean
  internal: boolean
  hidden: boolean
} {
  const raw = asRecord((event as unknown as Record<string, unknown>).ui)
  return {
    requiresConfirmation: raw.requiresConfirmation === true,
    clientExecutable: raw.clientExecutable === true,
    internal: raw.internal === true,
    hidden: raw.hidden === true,
  }
}

/**
 * Handle the completion signal from a client-executable tool.
 * Shared by both the main and subagent tool_call handlers.
 */
function handleClientCompletion(
  toolCall: ToolCallState,
  toolCallId: string,
  completion: { status: string; message?: string; data?: Record<string, unknown> } | null,
  context: StreamingContext
): void {
  if (completion?.status === 'background') {
    toolCall.status = 'skipped'
    toolCall.endTime = Date.now()
    markToolComplete(
      toolCall.id,
      toolCall.name,
      202,
      completion.message || 'Tool execution moved to background',
      { background: true },
      context.messageId
    ).catch((err) => {
      logger
        .withMetadata({ messageId: context.messageId })
        .error('markToolComplete fire-and-forget failed (client background)', {
          toolCallId: toolCall.id,
          error: err instanceof Error ? err.message : String(err),
        })
    })
    markToolResultSeen(toolCallId)
    return
  }
  if (completion?.status === 'rejected') {
    toolCall.status = 'rejected'
    toolCall.endTime = Date.now()
    markToolComplete(
      toolCall.id,
      toolCall.name,
      400,
      completion.message || 'Tool execution rejected',
      undefined,
      context.messageId
    ).catch((err) => {
      logger
        .withMetadata({ messageId: context.messageId })
        .error('markToolComplete fire-and-forget failed (client rejected)', {
          toolCallId: toolCall.id,
          error: err instanceof Error ? err.message : String(err),
        })
    })
    markToolResultSeen(toolCallId)
    return
  }
  if (completion?.status === 'cancelled') {
    toolCall.status = 'cancelled'
    toolCall.endTime = Date.now()
    markToolComplete(
      toolCall.id,
      toolCall.name,
      499,
      completion.message || 'Workflow execution was stopped manually by the user.',
      completion.data,
      context.messageId
    ).catch((err) => {
      logger
        .withMetadata({ messageId: context.messageId })
        .error('markToolComplete fire-and-forget failed (client cancelled)', {
          toolCallId: toolCall.id,
          error: err instanceof Error ? err.message : String(err),
        })
    })
    markToolResultSeen(toolCallId)
    return
  }
  const success = completion?.status === 'success'
  toolCall.status = success ? 'success' : 'error'
  toolCall.endTime = Date.now()
  const msg = completion?.message || (success ? 'Tool completed' : 'Tool failed or timed out')
  markToolComplete(
    toolCall.id,
    toolCall.name,
    success ? 200 : 500,
    msg,
    completion?.data,
    context.messageId
  ).catch((err) => {
    logger
      .withMetadata({ messageId: context.messageId })
      .error('markToolComplete fire-and-forget failed (client completion)', {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        error: err instanceof Error ? err.message : String(err),
      })
  })
  markToolResultSeen(toolCallId)
}

/**
 * Emit a synthetic tool_result SSE event to the client after a client-executable
 * tool completes. The server's actual tool_result is skipped (markToolResultSeen),
 * so the client would never learn the outcome without this.
 */
async function emitSyntheticToolResult(
  toolCallId: string,
  toolName: string,
  completion: { status: string; message?: string; data?: Record<string, unknown> } | null,
  options: OrchestratorOptions,
  context: StreamingContext
): Promise<void> {
  const success = completion?.status === 'success'
  const isCancelled = completion?.status === 'cancelled'

  const resultPayload = isCancelled
    ? { ...completion?.data, reason: 'user_cancelled', cancelledByUser: true }
    : completion?.data

  try {
    await options.onEvent?.({
      type: 'tool_result',
      toolCallId,
      toolName,
      success,
      result: resultPayload,
      error: !success ? completion?.message : undefined,
    } as SSEEvent)
  } catch (error) {
    logger
      .withMetadata({ messageId: context.messageId })
      .warn('Failed to emit synthetic tool_result', {
        toolCallId,
        toolName,
        error: error instanceof Error ? error.message : String(error),
      })
  }
}

// Normalization + dedupe helpers live in sse-utils to keep server/client in sync.

function inferToolSuccess(data: Record<string, unknown> | undefined): {
  success: boolean
  hasResultData: boolean
  hasError: boolean
} {
  const resultObj = asRecord(data?.result)
  const hasExplicitSuccess = data?.success !== undefined || resultObj.success !== undefined
  const explicitSuccess = data?.success ?? resultObj.success
  const hasResultData = data?.result !== undefined || data?.data !== undefined
  const hasError = !!data?.error || !!resultObj.error
  const success = hasExplicitSuccess ? !!explicitSuccess : !hasError
  return { success, hasResultData, hasError }
}

function ensureTerminalToolCallState(
  context: StreamingContext,
  toolCallId: string,
  toolName: string
): ToolCallState {
  const existing = context.toolCalls.get(toolCallId)
  if (existing) {
    return existing
  }

  const toolCall: ToolCallState = {
    id: toolCallId,
    name: toolName || 'unknown_tool',
    status: 'pending',
    startTime: Date.now(),
  }
  context.toolCalls.set(toolCallId, toolCall)
  addContentBlock(context, { type: 'tool_call', toolCall })
  return toolCall
}

export type SSEHandler = (
  event: SSEEvent,
  context: StreamingContext,
  execContext: ExecutionContext,
  options: OrchestratorOptions
) => void | Promise<void>

function addContentBlock(context: StreamingContext, block: Omit<ContentBlock, 'timestamp'>): void {
  context.contentBlocks.push({
    ...block,
    timestamp: Date.now(),
  })
}

export const sseHandlers: Record<string, SSEHandler> = {
  chat_id: (event, context, execContext) => {
    const chatId = asRecord(event.data).chatId as string | undefined
    context.chatId = chatId
    if (chatId) {
      execContext.chatId = chatId
    }
  },
  request_id: (event, context) => {
    const rid = typeof event.data === 'string' ? event.data : undefined
    if (rid) {
      context.requestId = rid
      logger
        .withMetadata({ messageId: context.messageId })
        .info('Mapped copilot message to Go trace ID', {
          goTraceId: rid,
          chatId: context.chatId,
          executionId: context.executionId,
          runId: context.runId,
        })
    }
  },
  title_updated: () => {},
  tool_result: (event, context) => {
    const data = getEventData(event)
    const toolCallId = event.toolCallId || (data?.id as string | undefined)
    if (!toolCallId) return
    const toolName =
      event.toolName ||
      (data?.name as string | undefined) ||
      context.toolCalls.get(toolCallId)?.name ||
      ''
    const current = ensureTerminalToolCallState(context, toolCallId, toolName)

    const { success, hasResultData, hasError } = inferToolSuccess(data)

    current.status = success ? 'success' : 'error'
    current.endTime = Date.now()
    if (hasResultData) {
      current.result = {
        success,
        output: data?.result || data?.data,
      }
    }
    if (hasError) {
      const resultObj = asRecord(data?.result)
      current.error = (data?.error || resultObj.error) as string | undefined
    }
    markToolResultSeen(toolCallId)
  },
  tool_error: (event, context) => {
    const data = getEventData(event)
    const toolCallId = event.toolCallId || (data?.id as string | undefined)
    if (!toolCallId) return
    const toolName =
      event.toolName ||
      (data?.name as string | undefined) ||
      context.toolCalls.get(toolCallId)?.name ||
      ''
    const current = ensureTerminalToolCallState(context, toolCallId, toolName)
    current.status = 'error'
    current.error = (data?.error as string | undefined) || 'Tool execution failed'
    current.endTime = Date.now()
    markToolResultSeen(toolCallId)
  },
  tool_call_delta: () => {
    // Argument streaming delta — no action needed on orchestrator side
  },
  tool_generating: (event, context) => {
    const data = getEventData(event)
    const toolCallId =
      event.toolCallId ||
      (data?.toolCallId as string | undefined) ||
      (data?.id as string | undefined)
    const toolName =
      event.toolName || (data?.toolName as string | undefined) || (data?.name as string | undefined)
    if (!toolCallId || !toolName) return
    if (!context.toolCalls.has(toolCallId)) {
      const toolCall = {
        id: toolCallId,
        name: toolName,
        status: 'pending' as const,
        startTime: Date.now(),
      }
      context.toolCalls.set(toolCallId, toolCall)
      addContentBlock(context, { type: 'tool_call', toolCall })
    }
  },
  tool_call: async (event, context, execContext, options) => {
    const toolData = getEventData(event) || ({} as Record<string, unknown>)
    const toolCallId = (toolData.id as string | undefined) || event.toolCallId
    const toolName = (toolData.name as string | undefined) || event.toolName
    if (!toolCallId || !toolName) return

    const args = (toolData.arguments || toolData.input || asRecord(event.data).input) as
      | Record<string, unknown>
      | undefined
    const isPartial = toolData.partial === true
    const existing = context.toolCalls.get(toolCallId)

    if (
      existing?.endTime ||
      (existing && existing.status !== 'pending' && existing.status !== 'executing')
    ) {
      if (!existing.name && toolName) {
        existing.name = toolName
      }
      if (!existing.params && args) {
        existing.params = args
      }
      return
    }

    if (existing) {
      if (args && !existing.params) existing.params = args
      if (
        !context.contentBlocks.some((b) => b.type === 'tool_call' && b.toolCall?.id === toolCallId)
      ) {
        addContentBlock(context, { type: 'tool_call', toolCall: existing })
      }
    } else {
      const created = {
        id: toolCallId,
        name: toolName,
        status: 'pending' as const,
        params: args,
        startTime: Date.now(),
      }
      context.toolCalls.set(toolCallId, created)
      addContentBlock(context, { type: 'tool_call', toolCall: created })
    }

    if (isPartial) return
    if (wasToolResultSeen(toolCallId)) return
    if (context.pendingToolPromises.has(toolCallId) || existing?.status === 'executing') {
      return
    }

    const toolCall = context.toolCalls.get(toolCallId)
    if (!toolCall) return

    const { clientExecutable, internal } = getEventUI(event)

    if (internal) {
      return
    }

    if (!isToolAvailableOnSimSide(toolName) && !clientExecutable) {
      return
    }

    /**
     * Fire tool execution without awaiting so parallel tool calls from the
     * same LLM turn execute concurrently. executeToolAndReport is self-contained:
     * it updates tool state, calls markToolComplete, and emits result events.
     */
    const fireToolExecution = () => {
      const pendingPromise = (async () => {
        try {
          await upsertAsyncToolCall({
            runId: context.runId || generateId(),
            toolCallId,
            toolName,
            args,
          })
        } catch (err) {
          logger
            .withMetadata({ messageId: context.messageId })
            .warn('Failed to persist async tool row before execution', {
              toolCallId,
              toolName,
              error: err instanceof Error ? err.message : String(err),
            })
        }
        return executeToolAndReport(toolCallId, context, execContext, options)
      })().catch((err) => {
        logger
          .withMetadata({ messageId: context.messageId })
          .error('Parallel tool execution failed', {
            toolCallId,
            toolName,
            error: err instanceof Error ? err.message : String(err),
          })
        return {
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
          data: { error: err instanceof Error ? err.message : String(err) },
        }
      })
      registerPendingToolPromise(context, toolCallId, pendingPromise)
    }

    if (options.interactive === false) {
      if (options.autoExecuteTools !== false) {
        if (!abortPendingToolIfStreamDead(toolCall, toolCallId, options, context)) {
          fireToolExecution()
        }
      }
      return
    }

    // Client-executable tool: execute server-side if available, otherwise
    // delegate to the client (React UI) and wait for completion.
    // Workflow run tools are implemented on Sim for MCP/server callers but must
    // still run in the browser when clientExecutable so the workflow terminal
    // receives SSE block logs (executeWorkflowWithFullLogging).
    if (clientExecutable) {
      const delegateWorkflowRunToClient = isWorkflowToolName(toolName)
      if (isToolAvailableOnSimSide(toolName) && !delegateWorkflowRunToClient) {
        if (!abortPendingToolIfStreamDead(toolCall, toolCallId, options, context)) {
          fireToolExecution()
        }
      } else {
        toolCall.status = 'executing'
        await upsertAsyncToolCall({
          runId: context.runId || generateId(),
          toolCallId,
          toolName,
          args,
          status: 'running',
        }).catch((err) => {
          logger
            .withMetadata({ messageId: context.messageId })
            .warn('Failed to persist async tool row for client-executable tool', {
              toolCallId,
              toolName,
              error: err instanceof Error ? err.message : String(err),
            })
        })
        const clientWaitSignal = buildClientToolAbortSignal(options)
        const completion = await waitForToolCompletion(
          toolCallId,
          options.timeout || STREAM_TIMEOUT_MS,
          clientWaitSignal
        )
        handleClientCompletion(toolCall, toolCallId, completion, context)
        await emitSyntheticToolResult(toolCallId, toolCall.name, completion, options, context)
      }
      return
    }

    if (options.autoExecuteTools !== false) {
      if (!abortPendingToolIfStreamDead(toolCall, toolCallId, options, context)) {
        fireToolExecution()
      }
    }
  },
  reasoning: (event, context) => {
    const d = asRecord(event.data)
    const phase = d.phase || asRecord(d.data).phase
    if (phase === 'start') {
      context.isInThinkingBlock = true
      context.currentThinkingBlock = {
        type: 'thinking',
        content: '',
        timestamp: Date.now(),
      }
      return
    }
    if (phase === 'end') {
      if (context.currentThinkingBlock) {
        context.contentBlocks.push(context.currentThinkingBlock)
      }
      context.isInThinkingBlock = false
      context.currentThinkingBlock = null
      return
    }
    const chunk = (d.data || d.content || event.content) as string | undefined
    if (!chunk || !context.currentThinkingBlock) return
    context.currentThinkingBlock.content = `${context.currentThinkingBlock.content || ''}${chunk}`
  },
  content: (event, context) => {
    // Server sends content as a plain string in event.data, not wrapped in an object.
    let chunk: string | undefined
    if (typeof event.data === 'string') {
      chunk = event.data
    } else {
      const d = asRecord(event.data)
      chunk = (d.content || d.data || event.content) as string | undefined
    }
    if (!chunk) return
    context.accumulatedContent += chunk
    addContentBlock(context, { type: 'text', content: chunk })
  },
  done: (event, context) => {
    const d = asRecord(event.data)
    const response = asRecord(d.response)
    const asyncPause = asRecord(response.async_pause)
    if (asyncPause.checkpointId) {
      context.awaitingAsyncContinuation = {
        checkpointId: String(asyncPause.checkpointId),
        executionId:
          typeof asyncPause.executionId === 'string' ? asyncPause.executionId : context.executionId,
        runId: typeof asyncPause.runId === 'string' ? asyncPause.runId : context.runId,
        pendingToolCallIds: Array.isArray(asyncPause.pendingToolCallIds)
          ? asyncPause.pendingToolCallIds.map((id) => String(id))
          : [],
      }
    }
    if (d.usage) {
      const u = asRecord(d.usage)
      context.usage = {
        prompt: (u.input_tokens as number) || 0,
        completion: (u.output_tokens as number) || 0,
      }
    }
    if (d.cost) {
      const c = asRecord(d.cost)
      context.cost = {
        input: (c.input as number) || 0,
        output: (c.output as number) || 0,
        total: (c.total as number) || 0,
      }
    }
    context.streamComplete = true
  },
  start: () => {},
  error: (event, context) => {
    const d = asRecord(event.data)
    const message = (d.message || d.error || event.error) as string | undefined
    if (message) {
      context.errors.push(message)
    }
    context.streamComplete = true
  },
}

export const subAgentHandlers: Record<string, SSEHandler> = {
  content: (event, context) => {
    const parentToolCallId = context.subAgentParentToolCallId
    if (!parentToolCallId || !event.data) return
    // Server sends content as a plain string in event.data
    let chunk: string | undefined
    if (typeof event.data === 'string') {
      chunk = event.data
    } else {
      const d = asRecord(event.data)
      chunk = (d.content || d.data || event.content) as string | undefined
    }
    if (!chunk) return
    context.subAgentContent[parentToolCallId] =
      (context.subAgentContent[parentToolCallId] || '') + chunk
    addContentBlock(context, { type: 'subagent_text', content: chunk })
  },
  tool_call: async (event, context, execContext, options) => {
    const parentToolCallId = context.subAgentParentToolCallId
    if (!parentToolCallId) return
    const toolData = getEventData(event) || ({} as Record<string, unknown>)
    const toolCallId = (toolData.id as string | undefined) || event.toolCallId
    const toolName = (toolData.name as string | undefined) || event.toolName
    if (!toolCallId || !toolName) return
    const isPartial = toolData.partial === true
    const args = (toolData.arguments || toolData.input || asRecord(event.data).input) as
      | Record<string, unknown>
      | undefined

    const existing = context.toolCalls.get(toolCallId)
    // Ignore late/duplicate tool_call events once we already have a result.
    if (wasToolResultSeen(toolCallId) || existing?.endTime) {
      if (existing && !existing.name && toolName) {
        existing.name = toolName
      }
      if (existing && !existing.params && args) {
        existing.params = args
      }
      return
    }

    const toolCall: ToolCallState = {
      id: toolCallId,
      name: toolName,
      status: 'pending',
      params: args,
      startTime: Date.now(),
    }

    // Store in both places - but do NOT overwrite existing tool call state for the same id.
    if (!context.subAgentToolCalls[parentToolCallId]) {
      context.subAgentToolCalls[parentToolCallId] = []
    }
    if (!context.subAgentToolCalls[parentToolCallId].some((tc) => tc.id === toolCallId)) {
      context.subAgentToolCalls[parentToolCallId].push(toolCall)
    }
    if (!context.toolCalls.has(toolCallId)) {
      context.toolCalls.set(toolCallId, toolCall)
      const parentToolCall = context.toolCalls.get(parentToolCallId)
      addContentBlock(context, {
        type: 'tool_call',
        toolCall,
        calledBy: parentToolCall?.name,
      })
    }

    if (isPartial) return
    if (context.pendingToolPromises.has(toolCallId) || existing?.status === 'executing') {
      return
    }

    const { clientExecutable, internal } = getEventUI(event)

    if (internal) {
      return
    }

    if (!isToolAvailableOnSimSide(toolName) && !clientExecutable) {
      return
    }

    const fireToolExecution = () => {
      const pendingPromise = (async () => {
        try {
          await upsertAsyncToolCall({
            runId: context.runId || generateId(),
            toolCallId,
            toolName,
            args,
          })
        } catch (err) {
          logger
            .withMetadata({ messageId: context.messageId })
            .warn('Failed to persist async subagent tool row before execution', {
              toolCallId,
              toolName,
              error: err instanceof Error ? err.message : String(err),
            })
        }
        return executeToolAndReport(toolCallId, context, execContext, options)
      })().catch((err) => {
        logger
          .withMetadata({ messageId: context.messageId })
          .error('Parallel subagent tool execution failed', {
            toolCallId,
            toolName,
            error: err instanceof Error ? err.message : String(err),
          })
        return {
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
          data: { error: err instanceof Error ? err.message : String(err) },
        }
      })
      registerPendingToolPromise(context, toolCallId, pendingPromise)
    }

    if (options.interactive === false) {
      if (options.autoExecuteTools !== false) {
        if (!abortPendingToolIfStreamDead(toolCall, toolCallId, options, context)) {
          fireToolExecution()
        }
      }
      return
    }

    if (clientExecutable) {
      const delegateWorkflowRunToClient = isWorkflowToolName(toolName)
      if (isToolAvailableOnSimSide(toolName) && !delegateWorkflowRunToClient) {
        if (!abortPendingToolIfStreamDead(toolCall, toolCallId, options, context)) {
          fireToolExecution()
        }
      } else {
        toolCall.status = 'executing'
        await upsertAsyncToolCall({
          runId: context.runId || generateId(),
          toolCallId,
          toolName,
          args,
          status: 'running',
        }).catch((err) => {
          logger
            .withMetadata({ messageId: context.messageId })
            .warn('Failed to persist async tool row for client-executable subagent tool', {
              toolCallId,
              toolName,
              error: err instanceof Error ? err.message : String(err),
            })
        })
        const clientWaitSignal = buildClientToolAbortSignal(options)
        const completion = await waitForToolCompletion(
          toolCallId,
          options.timeout || STREAM_TIMEOUT_MS,
          clientWaitSignal
        )
        handleClientCompletion(toolCall, toolCallId, completion, context)
        await emitSyntheticToolResult(toolCallId, toolCall.name, completion, options, context)
      }
      return
    }

    if (options.autoExecuteTools !== false) {
      if (!abortPendingToolIfStreamDead(toolCall, toolCallId, options, context)) {
        fireToolExecution()
      }
    }
  },
  tool_result: (event, context) => {
    const parentToolCallId = context.subAgentParentToolCallId
    if (!parentToolCallId) return
    const data = getEventData(event)
    const toolCallId = event.toolCallId || (data?.id as string | undefined)
    if (!toolCallId) return
    const toolName = event.toolName || (data?.name as string | undefined) || ''

    // Update in subAgentToolCalls.
    const toolCalls = context.subAgentToolCalls[parentToolCallId] || []
    const subAgentToolCall = toolCalls.find((tc) => tc.id === toolCallId)

    // Also update in main toolCalls (where we added it for execution).
    const mainToolCall = ensureTerminalToolCallState(context, toolCallId, toolName)

    const { success, hasResultData, hasError } = inferToolSuccess(data)

    const status = success ? 'success' : 'error'
    const endTime = Date.now()
    const result = hasResultData ? { success, output: data?.result || data?.data } : undefined

    if (subAgentToolCall) {
      subAgentToolCall.status = status
      subAgentToolCall.endTime = endTime
      if (result) subAgentToolCall.result = result
      if (hasError) {
        const resultObj = asRecord(data?.result)
        subAgentToolCall.error = (data?.error || resultObj.error) as string | undefined
      }
    }

    if (mainToolCall) {
      mainToolCall.status = status
      mainToolCall.endTime = endTime
      if (result) mainToolCall.result = result
      if (hasError) {
        const resultObj = asRecord(data?.result)
        mainToolCall.error = (data?.error || resultObj.error) as string | undefined
      }
    }
    if (subAgentToolCall || mainToolCall) {
      markToolResultSeen(toolCallId)
    }
  },
}

export function handleSubagentRouting(event: SSEEvent, context: StreamingContext): boolean {
  if (!event.subagent) return false
  if (!context.subAgentParentToolCallId) {
    logger
      .withMetadata({ messageId: context.messageId })
      .warn('Subagent event missing parent tool call', {
        type: event.type,
        subagent: event.subagent,
      })
    return false
  }
  return true
}
