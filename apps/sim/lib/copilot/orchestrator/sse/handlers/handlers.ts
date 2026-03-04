import { createLogger } from '@sim/logger'
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
import { executeToolAndReport, waitForToolCompletion, waitForToolDecision } from './tool-execution'

const logger = createLogger('CopilotSseHandlers')

/**
 * Extract the `ui` object from a Go SSE event. The Go backend enriches
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
  completion: { status: string; message?: string; data?: Record<string, unknown> } | null
): void {
  if (completion?.status === 'background') {
    toolCall.status = 'skipped'
    toolCall.endTime = Date.now()
    markToolComplete(
      toolCall.id,
      toolCall.name,
      202,
      completion.message || 'Tool execution moved to background',
      { background: true }
    ).catch((err) => {
      logger.error('markToolComplete fire-and-forget failed (client background)', {
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
      completion.message || 'Tool execution rejected'
    ).catch((err) => {
      logger.error('markToolComplete fire-and-forget failed (client rejected)', {
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
  markToolComplete(toolCall.id, toolCall.name, success ? 200 : 500, msg, completion?.data).catch(
    (err) => {
      logger.error('markToolComplete fire-and-forget failed (client completion)', {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  )
  markToolResultSeen(toolCallId)
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
  const success = hasExplicitSuccess ? !!explicitSuccess : hasResultData && !hasError
  return { success, hasResultData, hasError }
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
  chat_id: (event, context) => {
    context.chatId = asRecord(event.data).chatId as string | undefined
  },
  title_updated: () => {},
  tool_result: (event, context) => {
    const data = getEventData(event)
    const toolCallId = event.toolCallId || (data?.id as string | undefined)
    if (!toolCallId) return
    const current = context.toolCalls.get(toolCallId)
    if (!current) return

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
  },
  tool_error: (event, context) => {
    const data = getEventData(event)
    const toolCallId = event.toolCallId || (data?.id as string | undefined)
    if (!toolCallId) return
    const current = context.toolCalls.get(toolCallId)
    if (!current) return
    current.status = 'error'
    current.error = (data?.error as string | undefined) || 'Tool execution failed'
    current.endTime = Date.now()
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
      context.toolCalls.set(toolCallId, {
        id: toolCallId,
        name: toolName,
        status: 'pending',
        startTime: Date.now(),
      })
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
      if (!existing.params && args) {
        existing.params = args
      }
      return
    }

    if (existing) {
      if (args && !existing.params) existing.params = args
    } else {
      context.toolCalls.set(toolCallId, {
        id: toolCallId,
        name: toolName,
        status: 'pending',
        params: args,
        startTime: Date.now(),
      })
      const created = context.toolCalls.get(toolCallId)!
      addContentBlock(context, { type: 'tool_call', toolCall: created })
    }

    if (isPartial) return
    if (wasToolResultSeen(toolCallId)) return

    const toolCall = context.toolCalls.get(toolCallId)
    if (!toolCall) return

    const { requiresConfirmation, clientExecutable, internal } = getEventUI(event)

    if (internal) {
      return
    }

    if (!isToolAvailableOnSimSide(toolName)) {
      return
    }

    // Fire tool execution without awaiting so parallel tool calls from the
    // same LLM turn execute concurrently. executeToolAndReport is self-contained:
    // it updates tool state, calls markToolComplete, and emits result events.
    const fireToolExecution = () => {
      executeToolAndReport(toolCallId, context, execContext, options).catch((err) => {
        logger.error('Parallel tool execution failed', {
          toolCallId,
          toolName,
          error: err instanceof Error ? err.message : String(err),
        })
      })
    }

    // Non-interactive mode (Mothership/MCP): skip confirmation & client gates,
    // execute server-side directly.
    if (options.interactive === false) {
      if (options.autoExecuteTools !== false) {
        fireToolExecution()
      }
      return
    }

    if (requiresConfirmation) {
      const decision = await waitForToolDecision(
        toolCallId,
        options.timeout || STREAM_TIMEOUT_MS,
        options.abortSignal
      )

      if (decision?.status === 'accepted' || decision?.status === 'success') {
        if (clientExecutable) {
          toolCall.status = 'executing'
          const completion = await waitForToolCompletion(
            toolCallId,
            options.timeout || STREAM_TIMEOUT_MS,
            options.abortSignal
          )
          handleClientCompletion(toolCall, toolCallId, completion)
          return
        }
        fireToolExecution()
        return
      }

      if (decision?.status === 'rejected' || decision?.status === 'error') {
        toolCall.status = 'rejected'
        toolCall.endTime = Date.now()
        markToolComplete(
          toolCall.id,
          toolCall.name,
          400,
          decision.message || 'Tool execution rejected',
          { skipped: true, reason: 'user_rejected' }
        ).catch((err) => {
          logger.error('markToolComplete fire-and-forget failed (rejected)', {
            toolCallId: toolCall.id,
            error: err instanceof Error ? err.message : String(err),
          })
        })
        markToolResultSeen(toolCall.id)
        return
      }

      if (decision?.status === 'background') {
        toolCall.status = 'skipped'
        toolCall.endTime = Date.now()
        markToolComplete(
          toolCall.id,
          toolCall.name,
          202,
          decision.message || 'Tool execution moved to background',
          { background: true }
        ).catch((err) => {
          logger.error('markToolComplete fire-and-forget failed (background)', {
            toolCallId: toolCall.id,
            error: err instanceof Error ? err.message : String(err),
          })
        })
        markToolResultSeen(toolCall.id)
        return
      }

      toolCall.status = 'rejected'
      toolCall.endTime = Date.now()
      markToolComplete(toolCall.id, toolCall.name, 408, 'Tool approval timed out', {
        skipped: true,
        reason: 'timeout',
      }).catch((err) => {
        logger.error('markToolComplete fire-and-forget failed (timeout)', {
          toolCallId: toolCall.id,
          error: err instanceof Error ? err.message : String(err),
        })
      })
      markToolResultSeen(toolCall.id)
      return
    }

    // Auto-allowed client-executable tool: client runs it, we wait for completion.
    if (clientExecutable) {
      toolCall.status = 'executing'
      const completion = await waitForToolCompletion(
        toolCallId,
        options.timeout || STREAM_TIMEOUT_MS,
        options.abortSignal
      )
      handleClientCompletion(toolCall, toolCallId, completion)
      return
    }

    if (options.autoExecuteTools !== false) {
      fireToolExecution()
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
    // Go backend sends content as a plain string in event.data, not wrapped in an object.
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
  done: (_event, context) => {
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
    // Go backend sends content as a plain string in event.data
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
    }

    if (isPartial) return

    const { requiresConfirmation, clientExecutable, internal } = getEventUI(event)

    if (internal) {
      return
    }

    if (!isToolAvailableOnSimSide(toolName)) {
      return
    }

    const fireToolExecution = () => {
      executeToolAndReport(toolCallId, context, execContext, options).catch((err) => {
        logger.error('Parallel subagent tool execution failed', {
          toolCallId,
          toolName,
          error: err instanceof Error ? err.message : String(err),
        })
      })
    }

    // Non-interactive mode (Mothership/MCP): skip confirmation & client gates,
    // execute server-side directly.
    if (options.interactive === false) {
      if (options.autoExecuteTools !== false) {
        fireToolExecution()
      }
      return
    }

    if (requiresConfirmation) {
      const decision = await waitForToolDecision(
        toolCallId,
        options.timeout || STREAM_TIMEOUT_MS,
        options.abortSignal
      )
      if (decision?.status === 'accepted' || decision?.status === 'success') {
        if (clientExecutable) {
          toolCall.status = 'executing'
          const completion = await waitForToolCompletion(
            toolCallId,
            options.timeout || STREAM_TIMEOUT_MS,
            options.abortSignal
          )
          handleClientCompletion(toolCall, toolCallId, completion)
          return
        }
        fireToolExecution()
        return
      }
      if (decision?.status === 'rejected' || decision?.status === 'error') {
        toolCall.status = 'rejected'
        toolCall.endTime = Date.now()
        markToolComplete(
          toolCall.id,
          toolCall.name,
          400,
          decision.message || 'Tool execution rejected',
          { skipped: true, reason: 'user_rejected' }
        ).catch((err) => {
          logger.error('markToolComplete fire-and-forget failed (subagent rejected)', {
            toolCallId: toolCall.id,
            error: err instanceof Error ? err.message : String(err),
          })
        })
        markToolResultSeen(toolCall.id)
        return
      }
      if (decision?.status === 'background') {
        toolCall.status = 'skipped'
        toolCall.endTime = Date.now()
        markToolComplete(
          toolCall.id,
          toolCall.name,
          202,
          decision.message || 'Tool execution moved to background',
          { background: true }
        ).catch((err) => {
          logger.error('markToolComplete fire-and-forget failed (subagent background)', {
            toolCallId: toolCall.id,
            error: err instanceof Error ? err.message : String(err),
          })
        })
        markToolResultSeen(toolCall.id)
        return
      }

      toolCall.status = 'rejected'
      toolCall.endTime = Date.now()
      markToolComplete(toolCall.id, toolCall.name, 408, 'Tool approval timed out', {
        skipped: true,
        reason: 'timeout',
      }).catch((err) => {
        logger.error('markToolComplete fire-and-forget failed (subagent timeout)', {
          toolCallId: toolCall.id,
          error: err instanceof Error ? err.message : String(err),
        })
      })
      markToolResultSeen(toolCall.id)
      return
    }

    if (clientExecutable) {
      toolCall.status = 'executing'
      const completion = await waitForToolCompletion(
        toolCallId,
        options.timeout || STREAM_TIMEOUT_MS,
        options.abortSignal
      )
      handleClientCompletion(toolCall, toolCallId, completion)
      return
    }

    if (options.autoExecuteTools !== false) {
      fireToolExecution()
    }
  },
  tool_result: (event, context) => {
    const parentToolCallId = context.subAgentParentToolCallId
    if (!parentToolCallId) return
    const data = getEventData(event)
    const toolCallId = event.toolCallId || (data?.id as string | undefined)
    if (!toolCallId) return

    // Update in subAgentToolCalls.
    const toolCalls = context.subAgentToolCalls[parentToolCallId] || []
    const subAgentToolCall = toolCalls.find((tc) => tc.id === toolCallId)

    // Also update in main toolCalls (where we added it for execution).
    const mainToolCall = context.toolCalls.get(toolCallId)

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
  },
}

export function handleSubagentRouting(event: SSEEvent, context: StreamingContext): boolean {
  if (!event.subagent) return false
  if (!context.subAgentParentToolCallId) {
    logger.warn('Subagent event missing parent tool call', {
      type: event.type,
      subagent: event.subagent,
    })
    return false
  }
  return true
}
