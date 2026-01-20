/**
 * Stream Transformer - Converts Sim Agent SSE to Render Events
 *
 * This module processes the raw SSE stream from Sim Agent, executes tools,
 * persists to the database, and emits render events for the client.
 *
 * The client receives only render events and just needs to render them.
 */

import { createLogger } from '@sim/logger'
import { routeExecution } from '@/lib/copilot/tools/server/router'
import { isClientOnlyTool } from '@/lib/copilot/tools/client/ui-config'
import { env } from '@/lib/core/config/env'
import {
  type RenderEvent,
  type ToolDisplay,
  createRenderEvent,
  resetSeqCounter,
  serializeRenderEvent,
} from './render-events'
import { SIM_AGENT_API_URL_DEFAULT } from './constants'

const logger = createLogger('StreamTransformer')
const SIM_AGENT_API_URL = env.SIM_AGENT_API_URL || SIM_AGENT_API_URL_DEFAULT

// ============================================================================
// Types
// ============================================================================

export interface StreamTransformContext {
  streamId: string
  chatId: string
  userId: string
  workflowId?: string
  userMessageId: string
  assistantMessageId: string

  /** Callback to emit render events (sent to client via SSE) */
  onRenderEvent: (event: RenderEvent) => Promise<void>

  /** Callback to persist state (called at key moments) */
  onPersist?: (data: PersistData) => Promise<void>

  /** Callback to check if stream is aborted */
  isAborted?: () => boolean
}

export interface PersistData {
  type: 'content' | 'tool_call' | 'message_complete'
  content?: string
  toolCall?: {
    id: string
    name: string
    args: Record<string, unknown>
    state: 'pending' | 'executing' | 'success' | 'error'
    result?: unknown
  }
  messageComplete?: boolean
}

// Track state during stream processing
interface TransformState {
  // Content accumulation
  assistantContent: string

  // Thinking block state
  inThinkingBlock: boolean
  thinkingContent: string

  // Plan capture
  inPlanCapture: boolean
  planContent: string

  // Options capture
  inOptionsCapture: boolean
  optionsContent: string

  // Tool call tracking
  toolCalls: Map<
    string,
    {
      id: string
      name: string
      args: Record<string, unknown>
      state: 'pending' | 'generating' | 'executing' | 'success' | 'error'
      result?: unknown
    }
  >

  // Subagent tracking
  activeSubagent: string | null // parentToolCallId
  subagentToolCalls: Map<string, string> // toolCallId -> parentToolCallId
}

// ============================================================================
// Main Transformer
// ============================================================================

/**
 * Process a Sim Agent SSE stream and emit render events
 */
export async function transformStream(
  agentStream: ReadableStream<Uint8Array>,
  context: StreamTransformContext
): Promise<void> {
  const { streamId, chatId, userMessageId, assistantMessageId, onRenderEvent, isAborted } = context

  // Reset sequence counter for new stream
  resetSeqCounter()

  const state: TransformState = {
    assistantContent: '',
    inThinkingBlock: false,
    thinkingContent: '',
    inPlanCapture: false,
    planContent: '',
    inOptionsCapture: false,
    optionsContent: '',
    toolCalls: new Map(),
    activeSubagent: null,
    subagentToolCalls: new Map(),
  }

  // Emit stream start
  await emitEvent(onRenderEvent, 'stream_start', {
    streamId,
    chatId,
    userMessageId,
    assistantMessageId,
  })

  // Emit message start for assistant
  await emitEvent(onRenderEvent, 'message_start', {
    messageId: assistantMessageId,
    role: 'assistant',
  })

  const reader = agentStream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      // Check for abort
      if (isAborted?.()) {
        logger.info('Stream aborted by user', { streamId })
        // Abort any in-progress tools
        for (const [toolCallId, tool] of state.toolCalls) {
          if (tool.state === 'pending' || tool.state === 'executing') {
            await emitEvent(onRenderEvent, 'tool_aborted', {
              toolCallId,
              reason: 'User aborted',
            })
          }
        }
        break
      }

      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // Process complete SSE lines
      const lines = buffer.split('\n')
      buffer = lines.pop() || '' // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.startsWith('data: ') || line.length <= 6) continue

        try {
          const event = JSON.parse(line.slice(6))
          await processSimAgentEvent(event, state, context)
        } catch (e) {
          logger.warn('Failed to parse SSE event', { line: line.slice(0, 100) })
        }
      }
    }

    // Process any remaining buffer
    if (buffer.startsWith('data: ')) {
      try {
        const event = JSON.parse(buffer.slice(6))
        await processSimAgentEvent(event, state, context)
      } catch {}
    }

    // Finalize thinking block if still open
    if (state.inThinkingBlock) {
      await emitEvent(onRenderEvent, 'thinking_end', {})
    }

    // Finalize plan if still open
    if (state.inPlanCapture) {
      await finalizePlan(state, context)
    }

    // Finalize options if still open
    if (state.inOptionsCapture) {
      await finalizeOptions(state, context)
    }

    // Emit message end
    await emitEvent(onRenderEvent, 'message_end', { messageId: assistantMessageId })

    // Emit stream end
    await emitEvent(onRenderEvent, 'stream_end', {})

    // Persist final message
    await context.onPersist?.({
      type: 'message_complete',
      content: state.assistantContent,
      messageComplete: true,
    })

    // Emit message saved
    await emitEvent(onRenderEvent, 'message_saved', {
      messageId: assistantMessageId,
      refreshFromDb: false,
    })
  } catch (error) {
    logger.error('Stream transform error', { error, streamId })
    await emitEvent(onRenderEvent, 'stream_error', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  } finally {
    reader.releaseLock()
  }
}

// ============================================================================
// Event Processing
// ============================================================================

async function processSimAgentEvent(
  event: any,
  state: TransformState,
  context: StreamTransformContext
): Promise<void> {
  const { onRenderEvent } = context

  switch (event.type) {
    // ========== Content Events ==========
    case 'content':
      await handleContent(event, state, context)
      break

    // ========== Thinking Events ==========
    case 'thinking':
      await handleThinking(event, state, context)
      break

    // ========== Tool Call Events ==========
    case 'tool_call':
      await handleToolCall(event, state, context)
      break

    case 'tool_generating':
      await handleToolGenerating(event, state, context)
      break

    case 'tool_result':
      await handleToolResult(event, state, context)
      break

    case 'tool_error':
      await handleToolError(event, state, context)
      break

    // ========== Plan Events ==========
    case 'plan_capture_start':
      state.inPlanCapture = true
      state.planContent = ''
      await emitEvent(onRenderEvent, 'plan_start', {})
      break

    case 'plan_capture':
      if (state.inPlanCapture && event.data) {
        state.planContent += event.data
        await emitEvent(onRenderEvent, 'plan_delta', { content: event.data })
      }
      break

    case 'plan_capture_end':
      await finalizePlan(state, context)
      break

    // ========== Options Events ==========
    case 'options_stream_start':
      state.inOptionsCapture = true
      state.optionsContent = ''
      await emitEvent(onRenderEvent, 'options_start', {})
      break

    case 'options_stream':
      if (state.inOptionsCapture && event.data) {
        state.optionsContent += event.data
        await emitEvent(onRenderEvent, 'options_delta', { content: event.data })
      }
      break

    case 'options_stream_end':
      await finalizeOptions(state, context)
      break

    // ========== Subagent Events ==========
    case 'subagent_start':
      await handleSubagentStart(event, state, context)
      break

    case 'subagent_end':
      await handleSubagentEnd(event, state, context)
      break

    // ========== Response Events ==========
    case 'response_done':
      // Final response from Sim Agent
      logger.debug('Response done received', { streamId: context.streamId })
      break

    default:
      logger.debug('Unknown Sim Agent event type', { type: event.type })
  }
}

// ============================================================================
// Content Handling
// ============================================================================

async function handleContent(
  event: any,
  state: TransformState,
  context: StreamTransformContext
): Promise<void> {
  const content = event.data
  if (!content) return

  state.assistantContent += content

  // Check for thinking block markers
  if (content.includes('<think>') || content.includes('<thinking>')) {
    state.inThinkingBlock = true
    await context.onRenderEvent(createRenderEvent('thinking_start', {}))
    // Don't emit the marker as text
    return
  }

  if (content.includes('</think>') || content.includes('</thinking>')) {
    state.inThinkingBlock = false
    await context.onRenderEvent(createRenderEvent('thinking_end', {}))
    // Don't emit the marker as text
    return
  }

  // Route to appropriate handler
  if (state.inThinkingBlock) {
    state.thinkingContent += content
    await context.onRenderEvent(createRenderEvent('thinking_delta', { content }))
  } else {
    await context.onRenderEvent(createRenderEvent('text_delta', { content }))
  }
}

// ============================================================================
// Thinking Handling
// ============================================================================

async function handleThinking(
  event: any,
  state: TransformState,
  context: StreamTransformContext
): Promise<void> {
  const content = event.data || event.thinking
  if (!content) return

  // Start thinking block if not already
  if (!state.inThinkingBlock) {
    state.inThinkingBlock = true
    await context.onRenderEvent(createRenderEvent('thinking_start', {}))
  }

  state.thinkingContent += content
  await context.onRenderEvent(createRenderEvent('thinking_delta', { content }))
}

// ============================================================================
// Tool Call Handling
// ============================================================================

async function handleToolCall(
  event: any,
  state: TransformState,
  context: StreamTransformContext
): Promise<void> {
  const { onRenderEvent, userId, workflowId } = context
  const data = event.data || event
  const { id: toolCallId, name: toolName, arguments: args, partial } = data

  if (!toolCallId || !toolName) return

  // Check if this is a subagent tool call
  const isSubagentTool = state.activeSubagent !== null

  // Track the tool call
  const existingTool = state.toolCalls.get(toolCallId)

  if (partial) {
    // Streaming args
    if (!existingTool) {
      state.toolCalls.set(toolCallId, {
        id: toolCallId,
        name: toolName,
        args: args || {},
        state: 'generating',
      })
      if (isSubagentTool) {
        state.subagentToolCalls.set(toolCallId, state.activeSubagent!)
      }
    } else {
      existingTool.args = { ...existingTool.args, ...args }
    }

    const display = getToolDisplay(toolName, 'generating')

    if (isSubagentTool) {
      await emitEvent(onRenderEvent, 'subagent_tool_generating', {
        parentToolCallId: state.activeSubagent!,
        toolCallId,
        argsDelta: JSON.stringify(args),
      })
    } else {
      await emitEvent(onRenderEvent, 'tool_generating', {
        toolCallId,
        argsPartial: existingTool?.args || args,
      })
    }
    return
  }

  // Complete tool call - ready to execute
  const finalArgs = args || existingTool?.args || {}

  state.toolCalls.set(toolCallId, {
    id: toolCallId,
    name: toolName,
    args: finalArgs,
    state: 'pending',
  })

  if (isSubagentTool) {
    state.subagentToolCalls.set(toolCallId, state.activeSubagent!)
  }

  const display = getToolDisplay(toolName, 'pending')

  // Emit pending event
  if (isSubagentTool) {
    await emitEvent(onRenderEvent, 'subagent_tool_pending', {
      parentToolCallId: state.activeSubagent!,
      toolCallId,
      toolName,
      args: finalArgs,
      display,
    })
  } else {
    await emitEvent(onRenderEvent, 'tool_pending', {
      toolCallId,
      toolName,
      args: finalArgs,
      display,
    })
  }

  // Check if this tool needs user approval (interrupt)
  const needsInterrupt = checkToolNeedsInterrupt(toolName, finalArgs)
  if (needsInterrupt) {
    const options = getInterruptOptions(toolName, finalArgs)
    await emitEvent(onRenderEvent, 'interrupt_show', {
      toolCallId,
      toolName,
      options,
    })
    // Don't execute yet - wait for interrupt resolution
    return
  }

  // Check if this is a client-only tool
  if (isClientOnlyTool(toolName)) {
    logger.info('Skipping client-only tool on server', { toolName, toolCallId })
    // Client will handle this tool
    return
  }

  // Execute tool server-side - NON-BLOCKING for parallel execution
  // Fire off the execution and let tool_result event handle the completion
  executeToolServerSide(toolCallId, toolName, finalArgs, state, context).catch((err) => {
    logger.error('Tool execution failed (async)', { toolCallId, toolName, error: err })
  })
}

async function handleToolGenerating(
  event: any,
  state: TransformState,
  context: StreamTransformContext
): Promise<void> {
  const toolCallId = event.toolCallId || event.data?.id
  if (!toolCallId) return

  const isSubagentTool = state.subagentToolCalls.has(toolCallId)

  if (isSubagentTool) {
    await emitEvent(context.onRenderEvent, 'subagent_tool_generating', {
      parentToolCallId: state.subagentToolCalls.get(toolCallId)!,
      toolCallId,
      argsDelta: event.data,
    })
  } else {
    await emitEvent(context.onRenderEvent, 'tool_generating', {
      toolCallId,
      argsDelta: event.data,
    })
  }
}

async function handleToolResult(
  event: any,
  state: TransformState,
  context: StreamTransformContext
): Promise<void> {
  const toolCallId = event.toolCallId || event.data?.id
  const success = event.success !== false
  const result = event.result || event.data?.result

  if (!toolCallId) return

  const tool = state.toolCalls.get(toolCallId)

  // Skip if tool already in terminal state (server-side execution already emitted events)
  if (tool && (tool.state === 'success' || tool.state === 'error')) {
    logger.debug('Skipping duplicate tool_result event', { toolCallId, currentState: tool.state })
    return
  }

  if (tool) {
    tool.state = success ? 'success' : 'error'
    tool.result = result
  }

  const isSubagentTool = state.subagentToolCalls.has(toolCallId)
  const display = getToolDisplay(tool?.name || '', success ? 'success' : 'error')

  if (isSubagentTool) {
    await emitEvent(context.onRenderEvent, success ? 'subagent_tool_success' : 'subagent_tool_error', {
      parentToolCallId: state.subagentToolCalls.get(toolCallId)!,
      toolCallId,
      ...(success ? { result, display } : { error: event.error || 'Tool failed' }),
    })
  } else {
    if (success) {
      const successEvent: any = {
        toolCallId,
        result,
        display,
      }

      // Check if this was an edit_workflow that created a diff
      if (tool?.name === 'edit_workflow' && result?.workflowState) {
        successEvent.workflowId = context.workflowId
        successEvent.hasDiff = true
      }

      await emitEvent(context.onRenderEvent, 'tool_success', successEvent)
    } else {
      await emitEvent(context.onRenderEvent, 'tool_error', {
        toolCallId,
        error: event.error || 'Tool failed',
        display,
      })
    }
  }

  // Persist tool call result
  await context.onPersist?.({
    type: 'tool_call',
    toolCall: {
      id: toolCallId,
      name: tool?.name || '',
      args: tool?.args || {},
      state: success ? 'success' : 'error',
      result,
    },
  })
}

async function handleToolError(
  event: any,
  state: TransformState,
  context: StreamTransformContext
): Promise<void> {
  const toolCallId = event.toolCallId || event.data?.id
  const error = event.error || event.data?.error || 'Tool execution failed'

  if (!toolCallId) return

  const tool = state.toolCalls.get(toolCallId)
  if (tool) {
    tool.state = 'error'
  }

  const isSubagentTool = state.subagentToolCalls.has(toolCallId)
  const display = getToolDisplay(tool?.name || '', 'error')

  if (isSubagentTool) {
    await emitEvent(context.onRenderEvent, 'subagent_tool_error', {
      parentToolCallId: state.subagentToolCalls.get(toolCallId)!,
      toolCallId,
      error,
    })
  } else {
    await emitEvent(context.onRenderEvent, 'tool_error', {
      toolCallId,
      error,
      display,
    })
  }
}

// ============================================================================
// Tool Execution
// ============================================================================

async function executeToolServerSide(
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>,
  state: TransformState,
  context: StreamTransformContext
): Promise<void> {
  const { onRenderEvent, userId, workflowId } = context
  const isSubagentTool = state.subagentToolCalls.has(toolCallId)

  // Update state to executing
  const tool = state.toolCalls.get(toolCallId)
  if (tool) {
    tool.state = 'executing'
  }

  const display = getToolDisplay(toolName, 'executing')

  // Emit executing event
  if (isSubagentTool) {
    await emitEvent(onRenderEvent, 'subagent_tool_executing', {
      parentToolCallId: state.subagentToolCalls.get(toolCallId)!,
      toolCallId,
    })
  } else {
    await emitEvent(onRenderEvent, 'tool_executing', {
      toolCallId,
      display,
    })
  }

  try {
    // Add workflowId to args if available
    const execArgs = { ...args }
    if (workflowId && !execArgs.workflowId) {
      execArgs.workflowId = workflowId
    }

    // Execute the tool via the router
    const result = await routeExecution(toolName, execArgs, { userId })

    // Update state
    if (tool) {
      tool.state = 'success'
      tool.result = result
    }

    // Emit success event
    const successDisplay = getToolDisplay(toolName, 'success')

    if (isSubagentTool) {
      await emitEvent(onRenderEvent, 'subagent_tool_success', {
        parentToolCallId: state.subagentToolCalls.get(toolCallId)!,
        toolCallId,
        result,
        display: successDisplay,
      })
    } else {
      const successEvent: any = {
        toolCallId,
        result,
        display: successDisplay,
      }

      // Check if this was an edit_workflow that created a diff
      if (toolName === 'edit_workflow' && result?.workflowState) {
        successEvent.workflowId = workflowId
        successEvent.hasDiff = true

        // Emit diff_ready so client knows to read from DB
        await emitEvent(onRenderEvent, 'diff_ready', {
          workflowId: workflowId || '',
          toolCallId,
        })
      }

      await emitEvent(onRenderEvent, 'tool_success', successEvent)
    }

    // Notify Sim Agent that tool is complete
    await markToolComplete(toolCallId, toolName, true, result)

    // Persist tool result
    await context.onPersist?.({
      type: 'tool_call',
      toolCall: {
        id: toolCallId,
        name: toolName,
        args,
        state: 'success',
        result,
      },
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Tool execution failed'
    logger.error('Tool execution failed', { toolCallId, toolName, error: errorMessage })

    // Update state
    if (tool) {
      tool.state = 'error'
    }

    const errorDisplay = getToolDisplay(toolName, 'error')

    // Emit error event
    if (isSubagentTool) {
      await emitEvent(onRenderEvent, 'subagent_tool_error', {
        parentToolCallId: state.subagentToolCalls.get(toolCallId)!,
        toolCallId,
        error: errorMessage,
      })
    } else {
      await emitEvent(onRenderEvent, 'tool_error', {
        toolCallId,
        error: errorMessage,
        display: errorDisplay,
      })
    }

    // Notify Sim Agent that tool failed
    await markToolComplete(toolCallId, toolName, false, undefined, errorMessage)
  }
}

async function markToolComplete(
  toolCallId: string,
  toolName: string,
  success: boolean,
  result?: unknown,
  error?: string
): Promise<void> {
  try {
    const response = await fetch(`${SIM_AGENT_API_URL}/api/tools/mark-complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.COPILOT_API_KEY ? { 'x-api-key': env.COPILOT_API_KEY } : {}),
      },
      body: JSON.stringify({
        id: toolCallId,
        name: toolName,
        status: success ? 200 : 500,
        message: success
          ? (result as Record<string, unknown> | undefined)?.message || 'Success'
          : error,
        data: success ? result : undefined,
      }),
    })

    if (!response.ok) {
      logger.warn('Failed to mark tool complete', { toolCallId, status: response.status })
    }
  } catch (e) {
    logger.error('Error marking tool complete', { toolCallId, error: e })
  }
}

// ============================================================================
// Subagent Handling
// ============================================================================

async function handleSubagentStart(
  event: any,
  state: TransformState,
  context: StreamTransformContext
): Promise<void> {
  const parentToolCallId = event.parentToolCallId || event.data?.parentToolCallId
  const subagentId = event.subagentId || event.data?.subagentId || parentToolCallId
  const label = event.label || event.data?.label

  if (!parentToolCallId) return

  state.activeSubagent = parentToolCallId

  await emitEvent(context.onRenderEvent, 'subagent_start', {
    parentToolCallId,
    subagentId,
    label,
  })
}

async function handleSubagentEnd(
  event: any,
  state: TransformState,
  context: StreamTransformContext
): Promise<void> {
  const parentToolCallId = event.parentToolCallId || event.data?.parentToolCallId || state.activeSubagent

  if (!parentToolCallId) return

  state.activeSubagent = null

  await emitEvent(context.onRenderEvent, 'subagent_end', {
    parentToolCallId,
  })
}

// ============================================================================
// Plan & Options Handling
// ============================================================================

async function finalizePlan(state: TransformState, context: StreamTransformContext): Promise<void> {
  if (!state.inPlanCapture) return

  state.inPlanCapture = false

  // Parse todos from plan content
  const todos = parseTodosFromPlan(state.planContent)

  await emitEvent(context.onRenderEvent, 'plan_end', { todos })
}

async function finalizeOptions(
  state: TransformState,
  context: StreamTransformContext
): Promise<void> {
  if (!state.inOptionsCapture) return

  state.inOptionsCapture = false

  // Parse options from content
  const options = parseOptionsFromContent(state.optionsContent)

  await emitEvent(context.onRenderEvent, 'options_end', { options })
}

function parseTodosFromPlan(content: string): Array<{ id: string; content: string; status: 'pending' }> {
  const todos: Array<{ id: string; content: string; status: 'pending' }> = []
  const lines = content.split('\n')

  for (const line of lines) {
    const match = line.match(/^[-*]\s+(.+)$/)
    if (match) {
      todos.push({
        id: `todo_${Date.now()}_${todos.length}`,
        content: match[1].trim(),
        status: 'pending',
      })
    }
  }

  return todos
}

function parseOptionsFromContent(content: string): string[] {
  try {
    // Try to parse as JSON array
    const parsed = JSON.parse(content)
    if (Array.isArray(parsed)) {
      return parsed.filter((o) => typeof o === 'string')
    }
  } catch {}

  // Fall back to splitting by newlines
  return content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
}

// ============================================================================
// Helpers
// ============================================================================

function getToolDisplay(
  toolName: string,
  state: 'pending' | 'generating' | 'executing' | 'success' | 'error'
): ToolDisplay {
  // Default displays based on state
  const stateLabels: Record<string, string> = {
    pending: 'Pending...',
    generating: 'Preparing...',
    executing: 'Running...',
    success: 'Completed',
    error: 'Failed',
  }

  // Tool-specific labels
  const toolLabels: Record<string, string> = {
    edit_workflow: 'Editing workflow',
    get_user_workflow: 'Reading workflow',
    get_block_config: 'Getting block config',
    get_blocks_and_tools: 'Loading blocks',
    get_credentials: 'Checking credentials',
    run_workflow: 'Running workflow',
    knowledge_base: 'Searching knowledge base',
    navigate_ui: 'Navigating',
    tour: 'Starting tour',
  }

  return {
    label: toolLabels[toolName] || toolName.replace(/_/g, ' '),
    description: stateLabels[state],
  }
}

function checkToolNeedsInterrupt(toolName: string, args: Record<string, unknown>): boolean {
  // Tools that always need user approval
  const interruptTools = ['deploy_api', 'deploy_chat', 'deploy_mcp', 'delete_workflow']
  return interruptTools.includes(toolName)
}

function getInterruptOptions(
  toolName: string,
  args: Record<string, unknown>
): Array<{ id: string; label: string; description?: string; variant?: 'default' | 'destructive' | 'outline' }> {
  // Default interrupt options
  return [
    { id: 'approve', label: 'Approve', variant: 'default' },
    { id: 'reject', label: 'Cancel', variant: 'outline' },
  ]
}

async function emitEvent<T extends RenderEvent['type']>(
  onRenderEvent: (event: RenderEvent) => Promise<void>,
  type: T,
  data: Omit<Extract<RenderEvent, { type: T }>, 'type' | 'seq' | 'ts'>
): Promise<void> {
  const event = createRenderEvent(type, data)
  await onRenderEvent(event)
}

