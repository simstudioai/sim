import { createLogger } from '@sim/logger'
import { STREAM_TIMEOUT_MS } from '@/lib/copilot/constants'
import {
  asRecord,
  getEventData,
  markToolResultSeen,
  wasToolResultSeen,
} from '@/lib/copilot/orchestrator/sse-utils'
import { markToolComplete } from '@/lib/copilot/orchestrator/tool-executor'
import type {
  ContentBlock,
  ExecutionContext,
  OrchestratorOptions,
  SSEEvent,
  StreamingContext,
  ToolCallState,
} from '@/lib/copilot/orchestrator/types'
import {
  executeToolAndReport,
  waitForToolCompletion,
  waitForToolDecision,
} from './tool-execution'

const logger = createLogger('CopilotSseHandlers')

/**
 * Run tools that can be executed client-side for real-time feedback
 * (block pulsing, logs, stop button). When interactive, the server defers
 * execution to the browser client instead of running executeWorkflow directly.
 */
const CLIENT_EXECUTABLE_RUN_TOOLS = new Set([
  'workflow_run',
])

function mapServerStateToToolStatus(state: unknown): ToolCallState['status'] {
  switch (String(state || '')) {
    case 'generating':
    case 'pending':
    case 'awaiting_approval':
      return 'pending'
    case 'executing':
      return 'executing'
    case 'success':
      return 'success'
    case 'rejected':
    case 'skipped':
      return 'rejected'
    case 'aborted':
      return 'skipped'
    case 'error':
    case 'failed':
      return 'error'
    default:
      return 'pending'
  }
}

function getExecutionTarget(
  toolData: Record<string, unknown>,
  toolName: string
): { target: string; capabilityId?: string } {
  const execution = asRecord(toolData.execution)
  if (typeof execution.target === 'string' && execution.target.length > 0) {
    return {
      target: execution.target,
      capabilityId:
        typeof execution.capabilityId === 'string' ? execution.capabilityId : undefined,
    }
  }

  // Fallback only when metadata is missing.
  if (CLIENT_EXECUTABLE_RUN_TOOLS.has(toolName)) {
    return { target: 'sim_client_capability', capabilityId: 'workflow.run' }
  }
  return { target: 'sim_server' }
}

function needsApproval(toolData: Record<string, unknown>): boolean {
  const ui = asRecord(toolData.ui)
  return ui.showInterrupt === true
}

async function waitForClientCapabilityAndReport(
  toolCall: ToolCallState,
  options: OrchestratorOptions,
  logScope: string
): Promise<void> {
  toolCall.status = 'executing'
  const completion = await waitForToolCompletion(
    toolCall.id,
    options.timeout || STREAM_TIMEOUT_MS,
    options.abortSignal
  )

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
      logger.error(`markToolComplete fire-and-forget failed (${logScope} background)`, {
        toolCallId: toolCall.id,
        error: err instanceof Error ? err.message : String(err),
      })
    })
    markToolResultSeen(toolCall.id)
    return
  }

  if (completion?.status === 'rejected') {
    toolCall.status = 'rejected'
    toolCall.endTime = Date.now()
    markToolComplete(toolCall.id, toolCall.name, 400, completion.message || 'Tool execution rejected')
      .catch((err) => {
        logger.error(`markToolComplete fire-and-forget failed (${logScope} rejected)`, {
          toolCallId: toolCall.id,
          error: err instanceof Error ? err.message : String(err),
        })
      })
    markToolResultSeen(toolCall.id)
    return
  }

  const success = completion?.status === 'success'
  toolCall.status = success ? 'success' : 'error'
  toolCall.endTime = Date.now()
  const msg = completion?.message || (success ? 'Tool completed' : 'Tool failed or timed out')
  markToolComplete(toolCall.id, toolCall.name, success ? 200 : 500, msg).catch((err) => {
    logger.error(`markToolComplete fire-and-forget failed (${logScope})`, {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      error: err instanceof Error ? err.message : String(err),
    })
  })
  markToolResultSeen(toolCall.id)
}

function markToolCallAndNotify(
  toolCall: ToolCallState,
  statusCode: number,
  message: string,
  data: Record<string, unknown> | undefined,
  logScope: string
): void {
  markToolComplete(toolCall.id, toolCall.name, statusCode, message, data).catch((err) => {
    logger.error(`markToolComplete fire-and-forget failed (${logScope})`, {
      toolCallId: toolCall.id,
      error: err instanceof Error ? err.message : String(err),
    })
  })
  markToolResultSeen(toolCall.id)
}

async function executeToolCallWithPolicy(
  toolCall: ToolCallState,
  toolName: string,
  toolData: Record<string, unknown>,
  context: StreamingContext,
  execContext: ExecutionContext,
  options: OrchestratorOptions,
  logScope: string
): Promise<void> {
  const execution = getExecutionTarget(toolData, toolName)
  const isInteractive = options.interactive === true
  const requiresApproval = isInteractive && needsApproval(toolData)

  if (toolData.state) {
    toolCall.status = mapServerStateToToolStatus(toolData.state)
  }

  if (requiresApproval) {
    const decision = await waitForToolDecision(
      toolCall.id,
      options.timeout || STREAM_TIMEOUT_MS,
      options.abortSignal
    )

    if (decision?.status === 'accepted' || decision?.status === 'success') {
      // Continue below into normal execution path.
    } else if (decision?.status === 'rejected' || decision?.status === 'error') {
      toolCall.status = 'rejected'
      toolCall.endTime = Date.now()
      markToolCallAndNotify(
        toolCall,
        400,
        decision.message || 'Tool execution rejected',
        { skipped: true, reason: 'user_rejected' },
        `${logScope} rejected`
      )
      return
    } else if (decision?.status === 'background') {
      toolCall.status = 'skipped'
      toolCall.endTime = Date.now()
      markToolCallAndNotify(
        toolCall,
        202,
        decision.message || 'Tool execution moved to background',
        { background: true },
        `${logScope} background`
      )
      return
    } else {
      // Decision was null (timeout/abort).
      toolCall.status = 'rejected'
      toolCall.endTime = Date.now()
      markToolCallAndNotify(
        toolCall,
        408,
        'Tool approval timed out',
        { skipped: true, reason: 'timeout' },
        `${logScope} timeout`
      )
      return
    }
  }

  if (execution.target === 'sim_client_capability' && isInteractive) {
    await waitForClientCapabilityAndReport(toolCall, options, logScope)
    return
  }

  if (
    (execution.target === 'sim_server' || execution.target === 'sim_client_capability') &&
    options.autoExecuteTools !== false
  ) {
    await executeToolAndReport(toolCall.id, context, execContext, options)
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

    current.status = data?.state
      ? mapServerStateToToolStatus(data.state)
      : success
        ? 'success'
        : 'error'
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
    current.status = data?.state ? mapServerStateToToolStatus(data.state) : 'error'
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
        status: data?.state ? mapServerStateToToolStatus(data.state) : 'pending',
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
        status: toolData.state ? mapServerStateToToolStatus(toolData.state) : 'pending',
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

    await executeToolCallWithPolicy(
      toolCall,
      toolName,
      toolData,
      context,
      execContext,
      options,
      'run tool'
    )
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
      status: toolData.state ? mapServerStateToToolStatus(toolData.state) : 'pending',
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

    await executeToolCallWithPolicy(
      toolCall,
      toolName,
      toolData,
      context,
      execContext,
      options,
      'subagent run tool'
    )
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

    const status = data?.state ? mapServerStateToToolStatus(data.state) : success ? 'success' : 'error'
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
