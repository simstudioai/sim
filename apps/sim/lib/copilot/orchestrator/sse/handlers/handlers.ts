import { createLogger } from '@sim/logger'
import { upsertAsyncToolCall } from '@/lib/copilot/async-runs/repository'
import { STREAM_TIMEOUT_MS } from '@/lib/copilot/constants'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1RunKind,
  MothershipStreamV1SessionKind,
  MothershipStreamV1SpanLifecycleEvent,
  MothershipStreamV1TextChannel,
  MothershipStreamV1ToolExecutor,
  MothershipStreamV1ToolMode,
  MothershipStreamV1ToolPhase,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { TOOL_CALL_STATUS } from '@/lib/copilot/mothership-stream'
import {
  asRecord,
  getEventData,
  markToolResultSeen,
  wasToolResultSeen,
} from '@/lib/copilot/orchestrator/sse/utils'
import type {
  ContentBlock,
  ExecutionContext,
  OrchestratorOptions,
  StreamEvent,
  StreamingContext,
  ToolCallState,
} from '@/lib/copilot/orchestrator/types'
import { isSimExecuted } from '@/lib/copilot/tool-executor'
import { isWorkflowToolName } from '@/lib/copilot/workflow-tools'
import { executeToolAndReport, waitForToolCompletion } from './tool-execution'

const logger = createLogger('CopilotSseHandlers')

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
  return true
}

/**
 * Extract the `ui` object from a Go SSE event. The Go backend enriches
 * tool_call events with `ui: { requiresConfirmation, clientExecutable, ... }`.
 */
function getEventUI(event: StreamEvent): {
  requiresConfirmation: boolean
  clientExecutable: boolean
  internal: boolean
  hidden: boolean
} {
  const raw = asRecord(getEventData(event)?.ui)
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
  completion: { status: string; message?: string; data?: Record<string, unknown> } | null
): void {
  if (completion?.status === 'background') {
    toolCall.status = 'skipped'
    toolCall.endTime = Date.now()
    markToolResultSeen(toolCallId)
    return
  }
  if (completion?.status === 'rejected') {
    toolCall.status = 'rejected'
    toolCall.endTime = Date.now()
    markToolResultSeen(toolCallId)
    return
  }
  if (completion?.status === 'cancelled') {
    toolCall.status = 'cancelled'
    toolCall.endTime = Date.now()
    markToolResultSeen(toolCallId)
    return
  }
  const success = completion?.status === 'success'
  toolCall.status = success ? 'success' : 'error'
  toolCall.endTime = Date.now()
  markToolResultSeen(toolCallId)
}

/**
 * Emit a synthetic tool_result SSE event to the client after a client-executable
 * tool completes. The Go backend's actual tool_result is skipped (markToolResultSeen),
 * so the client would never learn the outcome without this.
 */
async function emitSyntheticToolResult(
  toolCallId: string,
  toolName: string,
  completion: { status: string; message?: string; data?: Record<string, unknown> } | null,
  options: OrchestratorOptions
): Promise<void> {
  const success = completion?.status === 'success'
  const isCancelled = completion?.status === 'cancelled'

  const resultPayload = isCancelled
    ? { ...completion?.data, reason: 'user_cancelled', cancelledByUser: true }
    : completion?.data

  try {
    await options.onEvent?.({
      type: MothershipStreamV1EventType.tool,
      payload: {
        toolCallId,
        toolName,
        executor: MothershipStreamV1ToolExecutor.client,
        mode: MothershipStreamV1ToolMode.async,
        phase: MothershipStreamV1ToolPhase.result,
        success,
        result: resultPayload,
        ...(completion?.status ? { status: completion.status } : {}),
        ...(!success && completion?.message ? { error: completion.message } : {}),
      },
    })
  } catch (error) {
    logger.warn('Failed to emit synthetic tool_result', {
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

export type StreamHandler = (
  event: StreamEvent,
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

export const sseHandlers: Record<string, StreamHandler> = {
  session: (event, context, execContext) => {
    const data = getEventData(event)
    if (data?.kind === MothershipStreamV1SessionKind.chat) {
      const chatId = data.chatId as string | undefined
      context.chatId = chatId
      if (chatId) {
        execContext.chatId = chatId
      }
    }
  },
  tool: async (event, context, execContext, options) => {
    const data = getEventData(event)
    const phase = data?.phase as string | undefined
    const toolCallId = (data?.toolCallId as string | undefined) || (data?.id as string | undefined)
    if (!toolCallId) return
    const toolName =
      (data?.toolName as string | undefined) ||
      (data?.name as string | undefined) ||
      context.toolCalls.get(toolCallId)?.name ||
      ''

    if (phase === MothershipStreamV1ToolPhase.args_delta) {
      return
    }

    if (phase === MothershipStreamV1ToolPhase.result) {
      const current = ensureTerminalToolCallState(context, toolCallId, toolName)
      const { success, hasResultData, hasError } = inferToolSuccess(data)
      current.status = data?.status === 'cancelled' ? 'cancelled' : success ? 'success' : 'error'
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
      return
    }

    const args = (data?.arguments || data?.input) as Record<string, unknown> | undefined
    const isGenerating = data?.status === TOOL_CALL_STATUS.generating
    const isPartial = data?.partial === true || isGenerating
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

    if (!isSimExecuted(toolName) && !clientExecutable) {
      return
    }

    /**
     * Fire tool execution without awaiting so parallel tool calls from the
     * same LLM turn execute concurrently. executeToolAndReport is self-contained:
     * it updates tool state and emits result events.
     */
    const fireToolExecution = () => {
      const pendingPromise = (async () => {
        try {
          await upsertAsyncToolCall({
            runId: context.runId || crypto.randomUUID(),
            toolCallId,
            toolName,
            args,
          })
        } catch (err) {
          logger.warn('Failed to persist async tool row before execution', {
            toolCallId,
            toolName,
            error: err instanceof Error ? err.message : String(err),
          })
        }
        return executeToolAndReport(toolCallId, context, execContext, options)
      })().catch((err) => {
        logger.error('Parallel tool execution failed', {
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
      if (isSimExecuted(toolName) && !delegateWorkflowRunToClient) {
        if (!abortPendingToolIfStreamDead(toolCall, toolCallId, options, context)) {
          fireToolExecution()
        }
      } else {
        toolCall.status = 'executing'
        await upsertAsyncToolCall({
          runId: context.runId || crypto.randomUUID(),
          toolCallId,
          toolName,
          args,
          status: 'running',
        }).catch((err) => {
          logger.warn('Failed to persist async tool row for client-executable tool', {
            toolCallId,
            toolName,
            error: err instanceof Error ? err.message : String(err),
          })
        })
        const completion = await waitForToolCompletion(
          toolCallId,
          options.timeout || STREAM_TIMEOUT_MS,
          options.abortSignal
        )
        handleClientCompletion(toolCall, toolCallId, completion)
        await emitSyntheticToolResult(toolCallId, toolCall.name, completion, options)
      }
      return
    }

    if (options.autoExecuteTools !== false) {
      if (!abortPendingToolIfStreamDead(toolCall, toolCallId, options, context)) {
        fireToolExecution()
      }
    }
  },
  text: (event, context) => {
    const d = getEventData(event)
    if (d?.channel === MothershipStreamV1TextChannel.thinking) {
      const phase = d.phase as string | undefined
      if (phase === MothershipStreamV1SpanLifecycleEvent.start) {
        context.isInThinkingBlock = true
        context.currentThinkingBlock = {
          type: 'thinking',
          content: '',
          timestamp: Date.now(),
        }
        return
      }
      if (phase === MothershipStreamV1SpanLifecycleEvent.end) {
        if (context.currentThinkingBlock) {
          context.contentBlocks.push(context.currentThinkingBlock)
        }
        context.isInThinkingBlock = false
        context.currentThinkingBlock = null
        return
      }
      const chunk = d?.text as string | undefined
      if (!chunk || !context.currentThinkingBlock) return
      context.currentThinkingBlock.content = `${context.currentThinkingBlock.content || ''}${chunk}`
      return
    }
    const chunk = d?.text as string | undefined
    if (!chunk) return
    context.accumulatedContent += chunk
    addContentBlock(context, { type: 'text', content: chunk })
  },
  run: (event, context) => {
    const d = getEventData(event)
    if (!d) return
    const kind = d?.kind as string | undefined
    if (kind === MothershipStreamV1RunKind.checkpoint_pause) {
      context.awaitingAsyncContinuation = {
        checkpointId: String(d?.checkpointId),
        executionId: typeof d?.executionId === 'string' ? d.executionId : context.executionId,
        runId: typeof d?.runId === 'string' ? d.runId : context.runId,
        pendingToolCallIds: Array.isArray(d?.pendingToolCallIds)
          ? d.pendingToolCallIds.map((id) => String(id))
          : [],
      }
      context.streamComplete = true
      return
    }
    if (kind === MothershipStreamV1RunKind.compaction_start) {
      addContentBlock(context, {
        type: 'tool_call',
        toolCall: {
          id: `compaction-${Date.now()}`,
          name: 'context_compaction',
          status: 'executing',
        },
      })
      return
    }
    if (kind === MothershipStreamV1RunKind.compaction_done) {
      addContentBlock(context, {
        type: 'tool_call',
        toolCall: {
          id: `compaction-${Date.now()}`,
          name: 'context_compaction',
          status: 'success',
        },
      })
      return
    }
  },
  complete: (event, context) => {
    const d = getEventData(event)
    if (!d) {
      context.streamComplete = true
      return
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
  error: (event, context) => {
    const d = getEventData(event)
    const message = (d?.message || d?.error) as string | undefined
    if (message) {
      context.errors.push(message)
    }
    context.streamComplete = true
  },
  span: () => {},
}

export const subAgentHandlers: Record<string, StreamHandler> = {
  text: (event, context) => {
    const parentToolCallId = context.subAgentParentToolCallId
    const d = getEventData(event)
    if (!parentToolCallId || d?.channel !== MothershipStreamV1TextChannel.assistant) return
    const chunk = d?.text as string | undefined
    if (!chunk) return
    context.subAgentContent[parentToolCallId] =
      (context.subAgentContent[parentToolCallId] || '') + chunk
    addContentBlock(context, { type: 'subagent_text', content: chunk })
  },
  tool: async (event, context, execContext, options) => {
    const parentToolCallId = context.subAgentParentToolCallId
    if (!parentToolCallId) return
    const toolData = getEventData(event) || ({} as Record<string, unknown>)
    const toolCallId =
      (toolData.toolCallId as string | undefined) || (toolData.id as string | undefined)
    const toolName =
      (toolData.toolName as string | undefined) || (toolData.name as string | undefined)
    if (!toolCallId || !toolName) return
    const phase = toolData.phase as string | undefined
    if (phase === MothershipStreamV1ToolPhase.args_delta) return
    if (phase === MothershipStreamV1ToolPhase.result) {
      const toolCalls = context.subAgentToolCalls[parentToolCallId] || []
      const subAgentToolCall = toolCalls.find((tc) => tc.id === toolCallId)
      const mainToolCall = ensureTerminalToolCallState(context, toolCallId, toolName)
      const { success, hasResultData, hasError } = inferToolSuccess(toolData)
      const status = toolData.status === 'cancelled' ? 'cancelled' : success ? 'success' : 'error'
      const endTime = Date.now()
      const result = hasResultData
        ? { success, output: toolData?.result || toolData?.data }
        : undefined

      if (subAgentToolCall) {
        subAgentToolCall.status = status
        subAgentToolCall.endTime = endTime
        if (result) subAgentToolCall.result = result
        if (hasError) {
          const resultObj = asRecord(toolData?.result)
          subAgentToolCall.error = (toolData?.error || resultObj.error) as string | undefined
        }
      }

      mainToolCall.status = status
      mainToolCall.endTime = endTime
      if (result) mainToolCall.result = result
      if (hasError) {
        const resultObj = asRecord(toolData?.result)
        mainToolCall.error = (toolData?.error || resultObj.error) as string | undefined
      }
      markToolResultSeen(toolCallId)
      return
    }
    const isGenerating = toolData.status === TOOL_CALL_STATUS.generating
    const isPartial = toolData.partial === true || isGenerating
    const args = (toolData.arguments || toolData.input) as Record<string, unknown> | undefined

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

    if (!isSimExecuted(toolName) && !clientExecutable) {
      return
    }

    const fireToolExecution = () => {
      const pendingPromise = (async () => {
        try {
          await upsertAsyncToolCall({
            runId: context.runId || crypto.randomUUID(),
            toolCallId,
            toolName,
            args,
          })
        } catch (err) {
          logger.warn('Failed to persist async subagent tool row before execution', {
            toolCallId,
            toolName,
            error: err instanceof Error ? err.message : String(err),
          })
        }
        return executeToolAndReport(toolCallId, context, execContext, options)
      })().catch((err) => {
        logger.error('Parallel subagent tool execution failed', {
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
      if (isSimExecuted(toolName) && !delegateWorkflowRunToClient) {
        if (!abortPendingToolIfStreamDead(toolCall, toolCallId, options, context)) {
          fireToolExecution()
        }
      } else {
        toolCall.status = 'executing'
        await upsertAsyncToolCall({
          runId: context.runId || crypto.randomUUID(),
          toolCallId,
          toolName,
          args,
          status: 'running',
        }).catch((err) => {
          logger.warn('Failed to persist async tool row for client-executable subagent tool', {
            toolCallId,
            toolName,
            error: err instanceof Error ? err.message : String(err),
          })
        })
        const completion = await waitForToolCompletion(
          toolCallId,
          options.timeout || STREAM_TIMEOUT_MS,
          options.abortSignal
        )
        handleClientCompletion(toolCall, toolCallId, completion)
        await emitSyntheticToolResult(toolCallId, toolCall.name, completion, options)
      }
      return
    }

    if (options.autoExecuteTools !== false) {
      if (!abortPendingToolIfStreamDead(toolCall, toolCallId, options, context)) {
        fireToolExecution()
      }
    }
  },
  span: () => {},
}

export function handleSubagentRouting(event: StreamEvent, context: StreamingContext): boolean {
  if (event.scope?.lane !== 'subagent') return false
  if (!context.subAgentParentToolCallId) {
    logger.warn('Subagent event missing parent tool call', {
      type: event.type,
      subagent: event.scope?.agentId,
    })
    return false
  }
  return true
}
