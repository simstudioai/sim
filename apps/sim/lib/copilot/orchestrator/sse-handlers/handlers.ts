import { createLogger } from '@sim/logger'
import { STREAM_TIMEOUT_MS } from '@/lib/copilot/constants'
import { RESPOND_TOOL_SET, SUBAGENT_TOOL_SET } from '@/lib/copilot/orchestrator/config'
import {
  asRecord,
  getEventData,
  markToolResultSeen,
  wasToolResultSeen,
} from '@/lib/copilot/orchestrator/sse-utils'
import {
  isIntegrationTool,
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
import { executeToolAndReport, isInterruptToolName, waitForToolDecision } from './tool-execution'

const logger = createLogger('CopilotSseHandlers')

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

    // If we've already completed this tool call, ignore late/duplicate tool_call events
    // to avoid resetting UI/state back to pending and re-executing.
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

    // Subagent tools are executed by the copilot backend, not sim side.
    if (SUBAGENT_TOOL_SET.has(toolName)) {
      return
    }

    // Respond tools are internal to copilot's subagent system - skip execution.
    // The copilot backend handles these internally to signal subagent completion.
    if (RESPOND_TOOL_SET.has(toolName)) {
      toolCall.status = 'success'
      toolCall.endTime = Date.now()
      toolCall.result = {
        success: true,
        output: 'Internal respond tool - handled by copilot backend',
      }
      return
    }

    const isInterruptTool = isInterruptToolName(toolName)
    const isInteractive = options.interactive === true
    // Integration tools (user-installed) also require approval in interactive mode
    const needsApproval = isInterruptTool || isIntegrationTool(toolName)

    if (needsApproval && isInteractive) {
      const decision = await waitForToolDecision(
        toolCallId,
        options.timeout || STREAM_TIMEOUT_MS,
        options.abortSignal
      )
      if (decision?.status === 'accepted' || decision?.status === 'success') {
        await executeToolAndReport(toolCallId, context, execContext, options)
        return
      }

      if (decision?.status === 'rejected' || decision?.status === 'error') {
        toolCall.status = 'rejected'
        toolCall.endTime = Date.now()
        await markToolComplete(
          toolCall.id,
          toolCall.name,
          400,
          decision.message || 'Tool execution rejected',
          { skipped: true, reason: 'user_rejected' }
        )
        markToolResultSeen(toolCall.id)
        await options.onEvent?.({
          type: 'tool_result',
          toolCallId: toolCall.id,
          data: {
            id: toolCall.id,
            name: toolCall.name,
            success: false,
            result: { skipped: true, reason: 'user_rejected' },
          },
        })
        return
      }

      if (decision?.status === 'background') {
        toolCall.status = 'skipped'
        toolCall.endTime = Date.now()
        await markToolComplete(
          toolCall.id,
          toolCall.name,
          202,
          decision.message || 'Tool execution moved to background',
          { background: true }
        )
        markToolResultSeen(toolCall.id)
        await options.onEvent?.({
          type: 'tool_result',
          toolCallId: toolCall.id,
          data: {
            id: toolCall.id,
            name: toolCall.name,
            success: true,
            result: { background: true },
          },
        })
        return
      }
    }

    if (options.autoExecuteTools !== false) {
      await executeToolAndReport(toolCallId, context, execContext, options)
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
  done: (event, context) => {
    const d = asRecord(event.data)
    if (d.responseId) {
      context.conversationId = d.responseId as string
    }
    context.streamComplete = true
  },
  start: (event, context) => {
    const d = asRecord(event.data)
    if (d.responseId) {
      context.conversationId = d.responseId as string
    }
  },
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

    // Respond tools are internal to copilot's subagent system - skip execution.
    if (RESPOND_TOOL_SET.has(toolName)) {
      toolCall.status = 'success'
      toolCall.endTime = Date.now()
      toolCall.result = {
        success: true,
        output: 'Internal respond tool - handled by copilot backend',
      }
      return
    }

    // Tools that only exist on the Go backend (e.g. search_patterns,
    // search_errors, remember_debug) should NOT be re-executed on the Sim side.
    // The Go backend already executed them and will send its own tool_result
    // SSE event with the real outcome.  Trying to execute them here would fail
    // with "Tool not found" and incorrectly mark the tool as failed.
    if (!isToolAvailableOnSimSide(toolName)) {
      return
    }

    // Integration tools (user-installed) require approval in interactive mode,
    // same as top-level interrupt tools.
    if (options.interactive === true && isIntegrationTool(toolName)) {
      const decision = await waitForToolDecision(
        toolCallId,
        options.timeout || STREAM_TIMEOUT_MS,
        options.abortSignal
      )
      if (decision?.status === 'accepted' || decision?.status === 'success') {
        await executeToolAndReport(toolCallId, context, execContext, options)
        return
      }
      if (decision?.status === 'rejected' || decision?.status === 'error') {
        toolCall.status = 'rejected'
        toolCall.endTime = Date.now()
        await markToolComplete(
          toolCall.id,
          toolCall.name,
          400,
          decision.message || 'Tool execution rejected',
          { skipped: true, reason: 'user_rejected' }
        )
        markToolResultSeen(toolCall.id)
        await options?.onEvent?.({
          type: 'tool_result',
          toolCallId: toolCall.id,
          data: {
            id: toolCall.id,
            name: toolCall.name,
            success: false,
            result: { skipped: true, reason: 'user_rejected' },
          },
        })
        return
      }
      if (decision?.status === 'background') {
        toolCall.status = 'skipped'
        toolCall.endTime = Date.now()
        await markToolComplete(
          toolCall.id,
          toolCall.name,
          202,
          decision.message || 'Tool execution moved to background',
          { background: true }
        )
        markToolResultSeen(toolCall.id)
        await options?.onEvent?.({
          type: 'tool_result',
          toolCallId: toolCall.id,
          data: {
            id: toolCall.id,
            name: toolCall.name,
            success: true,
            result: { background: true },
          },
        })
        return
      }
    }

    if (options.autoExecuteTools !== false) {
      await executeToolAndReport(toolCallId, context, execContext, options)
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
