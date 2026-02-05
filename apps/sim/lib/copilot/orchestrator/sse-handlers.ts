import { createLogger } from '@sim/logger'
import {
  INTERRUPT_TOOL_SET,
  RESPOND_TOOL_SET,
  SUBAGENT_TOOL_SET,
} from '@/lib/copilot/orchestrator/config'
import { getToolConfirmation } from '@/lib/copilot/orchestrator/persistence'
import {
  asRecord,
  getEventData,
  markToolResultSeen,
  wasToolResultSeen,
} from '@/lib/copilot/orchestrator/sse-utils'
import { executeToolServerSide, markToolComplete } from '@/lib/copilot/orchestrator/tool-executor'
import type {
  ContentBlock,
  ExecutionContext,
  OrchestratorOptions,
  SSEEvent,
  StreamingContext,
  ToolCallState,
} from '@/lib/copilot/orchestrator/types'

const logger = createLogger('CopilotSseHandlers')

// Normalization + dedupe helpers live in sse-utils to keep server/client in sync.

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

async function executeToolAndReport(
  toolCallId: string,
  context: StreamingContext,
  execContext: ExecutionContext,
  options?: OrchestratorOptions
): Promise<void> {
  const toolCall = context.toolCalls.get(toolCallId)
  if (!toolCall) return

  if (toolCall.status === 'executing') return
  if (wasToolResultSeen(toolCall.id)) return

  toolCall.status = 'executing'
  try {
    const result = await executeToolServerSide(toolCall, execContext)
    toolCall.status = result.success ? 'success' : 'error'
    toolCall.result = result
    toolCall.error = result.error
    toolCall.endTime = Date.now()

    // If create_workflow was successful, update the execution context with the new workflowId
    // This ensures subsequent tools in the same stream have access to the workflowId
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

    await markToolComplete(
      toolCall.id,
      toolCall.name,
      result.success ? 200 : 500,
      result.error || (result.success ? 'Tool completed' : 'Tool failed'),
      result.output
    )

    await options?.onEvent?.({
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
    })
  } catch (error) {
    toolCall.status = 'error'
    toolCall.error = error instanceof Error ? error.message : String(error)
    toolCall.endTime = Date.now()

    markToolResultSeen(toolCall.id)

    await markToolComplete(toolCall.id, toolCall.name, 500, toolCall.error)

    await options?.onEvent?.({
      type: 'tool_error',
      toolCallId: toolCall.id,
      data: {
        id: toolCall.id,
        name: toolCall.name,
        error: toolCall.error,
      },
    })
  }
}

async function waitForToolDecision(
  toolCallId: string,
  timeoutMs: number
): Promise<{ status: string; message?: string } | null> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const decision = await getToolConfirmation(toolCallId)
    if (decision?.status) {
      return decision
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return null
}

export const sseHandlers: Record<string, SSEHandler> = {
  chat_id: (event, context) => {
    context.chatId = asRecord(event.data).chatId
  },
  title_updated: () => {},
  tool_result: (event, context) => {
    const data = getEventData(event)
    const toolCallId = event.toolCallId || data?.id
    if (!toolCallId) return
    const current = context.toolCalls.get(toolCallId)
    if (!current) return

    // Determine success: explicit success field, or if there's result data without explicit failure
    const hasExplicitSuccess = data?.success !== undefined || data?.result?.success !== undefined
    const explicitSuccess = data?.success ?? data?.result?.success
    const hasResultData = data?.result !== undefined || data?.data !== undefined
    const hasError = !!data?.error || !!data?.result?.error

    // If explicitly set, use that; otherwise infer from data presence
    const success = hasExplicitSuccess ? !!explicitSuccess : hasResultData && !hasError

    current.status = success ? 'success' : 'error'
    current.endTime = Date.now()
    if (hasResultData) {
      current.result = {
        success,
        output: data?.result || data?.data,
      }
    }
    if (hasError) {
      current.error = data?.error || data?.result?.error
    }
  },
  tool_error: (event, context) => {
    const data = getEventData(event)
    const toolCallId = event.toolCallId || data?.id
    if (!toolCallId) return
    const current = context.toolCalls.get(toolCallId)
    if (!current) return
    current.status = 'error'
    current.error = data?.error || 'Tool execution failed'
    current.endTime = Date.now()
  },
  tool_generating: (event, context) => {
    const data = getEventData(event)
    const toolCallId = event.toolCallId || data?.toolCallId || data?.id
    const toolName = event.toolName || data?.toolName || data?.name
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
    const toolData = getEventData(event) || {}
    const toolCallId = toolData.id || event.toolCallId
    const toolName = toolData.name || event.toolName
    if (!toolCallId || !toolName) return

    const args = toolData.arguments || toolData.input || asRecord(event.data).input
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

    // Subagent tools are executed by the copilot backend, not sim side
    if (SUBAGENT_TOOL_SET.has(toolName)) {
      return
    }

    // Respond tools are internal to copilot's subagent system - skip execution
    // The copilot backend handles these internally to signal subagent completion
    if (RESPOND_TOOL_SET.has(toolName)) {
      toolCall.status = 'success'
      toolCall.endTime = Date.now()
      toolCall.result = {
        success: true,
        output: 'Internal respond tool - handled by copilot backend',
      }
      return
    }

    const isInterruptTool = INTERRUPT_TOOL_SET.has(toolName)
    const isInteractive = options.interactive === true

    if (isInterruptTool && isInteractive) {
      const decision = await waitForToolDecision(toolCallId, options.timeout || 600000)
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
    const phase = asRecord(event.data).phase || asRecord(asRecord(event.data).data).phase
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
    const d = asRecord(event.data)
    const chunk = typeof event.data === 'string' ? event.data : d.data || d.content
    if (!chunk || !context.currentThinkingBlock) return
    context.currentThinkingBlock.content = `${context.currentThinkingBlock.content || ''}${chunk}`
  },
  content: (event, context) => {
    const d = asRecord(event.data)
    const chunk = typeof event.data === 'string' ? event.data : d.content || d.data
    if (!chunk) return
    context.accumulatedContent += chunk
    addContentBlock(context, { type: 'text', content: chunk as string })
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
    const message =
      d.message || d.error || (typeof event.data === 'string' ? event.data : null)
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
    const chunk = typeof event.data === 'string' ? event.data : asRecord(event.data).content || ''
    if (!chunk) return
    context.subAgentContent[parentToolCallId] =
      (context.subAgentContent[parentToolCallId] || '') + chunk
    addContentBlock(context, { type: 'subagent_text', content: chunk })
  },
  tool_call: async (event, context, execContext, options) => {
    const parentToolCallId = context.subAgentParentToolCallId
    if (!parentToolCallId) return
    const toolData = getEventData(event) || {}
    const toolCallId = toolData.id || event.toolCallId
    const toolName = toolData.name || event.toolName
    if (!toolCallId || !toolName) return
    const isPartial = toolData.partial === true
    const args = toolData.arguments || toolData.input || asRecord(event.data).input

    const existing = context.toolCalls.get(toolCallId)
    // Ignore late/duplicate tool_call events once we already have a result
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

    // Store in both places - but do NOT overwrite existing tool call state for the same id
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

    // Respond tools are internal to copilot's subagent system - skip execution
    if (RESPOND_TOOL_SET.has(toolName)) {
      toolCall.status = 'success'
      toolCall.endTime = Date.now()
      toolCall.result = {
        success: true,
        output: 'Internal respond tool - handled by copilot backend',
      }
      return
    }

    if (options.autoExecuteTools !== false) {
      await executeToolAndReport(toolCallId, context, execContext, options)
    }
  },
  tool_result: (event, context) => {
    const parentToolCallId = context.subAgentParentToolCallId
    if (!parentToolCallId) return
    const data = getEventData(event)
    const toolCallId = event.toolCallId || data?.id
    if (!toolCallId) return

    // Update in subAgentToolCalls
    const toolCalls = context.subAgentToolCalls[parentToolCallId] || []
    const subAgentToolCall = toolCalls.find((tc) => tc.id === toolCallId)

    // Also update in main toolCalls (where we added it for execution)
    const mainToolCall = context.toolCalls.get(toolCallId)

    // Use same success inference logic as main handler
    const hasExplicitSuccess = data?.success !== undefined || data?.result?.success !== undefined
    const explicitSuccess = data?.success ?? data?.result?.success
    const hasResultData = data?.result !== undefined || data?.data !== undefined
    const hasError = !!data?.error || !!data?.result?.error
    const success = hasExplicitSuccess ? !!explicitSuccess : hasResultData && !hasError

    const status = success ? 'success' : 'error'
    const endTime = Date.now()
    const result = hasResultData ? { success, output: data?.result || data?.data } : undefined

    if (subAgentToolCall) {
      subAgentToolCall.status = status
      subAgentToolCall.endTime = endTime
      if (result) subAgentToolCall.result = result
      if (hasError) subAgentToolCall.error = data?.error || data?.result?.error
    }

    if (mainToolCall) {
      mainToolCall.status = status
      mainToolCall.endTime = endTime
      if (result) mainToolCall.result = result
      if (hasError) mainToolCall.error = data?.error || data?.result?.error
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
