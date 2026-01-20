/**
 * Client Renderer - Handles render events from the server
 *
 * This is the client-side counterpart to the stream transformer.
 * It receives render events from the server and updates the UI accordingly.
 * All business logic (tool execution, persistence) is handled server-side.
 * The client just renders.
 */

import { createLogger } from '@sim/logger'
import type { RenderEvent, RenderEventType } from './render-events'

const logger = createLogger('ClientRenderer')

// ============================================================================
// Types
// ============================================================================

export interface RendererState {
  // Stream state
  streamId: string | null
  chatId: string | null
  isStreaming: boolean
  isComplete: boolean
  hasError: boolean
  errorMessage: string | null

  // Message state
  currentMessageId: string | null
  content: string

  // Thinking state
  isThinking: boolean
  thinkingContent: string

  // Tool calls
  toolCalls: Map<string, ToolCallState>

  // Plan state
  isCapturingPlan: boolean
  planContent: string
  planTodos: PlanTodo[]

  // Options state
  isCapturingOptions: boolean
  optionsContent: string
  options: string[]

  // Subagent state
  activeSubagents: Map<string, SubagentState>

  // Interrupts
  pendingInterrupts: Map<string, InterruptState>
}

export interface ToolCallState {
  id: string
  name: string
  args: Record<string, unknown>
  status: 'pending' | 'generating' | 'executing' | 'success' | 'error' | 'aborted'
  result?: unknown
  error?: string
  display: {
    label: string
    description?: string
  }
}

export interface SubagentState {
  parentToolCallId: string
  subagentId: string
  label?: string
  toolCalls: Map<string, ToolCallState>
}

export interface PlanTodo {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

export interface InterruptState {
  toolCallId: string
  toolName: string
  options: Array<{
    id: string
    label: string
    description?: string
    variant?: 'default' | 'destructive' | 'outline'
  }>
  message?: string
}

export interface RendererCallbacks {
  /** Called when state changes - trigger UI re-render */
  onStateChange: (state: RendererState) => void

  /** Called when a diff is ready - read workflow from DB */
  onDiffReady?: (workflowId: string, toolCallId: string) => void

  /** Called when user needs to resolve an interrupt */
  onInterruptRequired?: (interrupt: InterruptState) => void

  /** Called when stream completes */
  onStreamComplete?: () => void

  /** Called when stream errors */
  onStreamError?: (error: string) => void
}

// ============================================================================
// Renderer Class
// ============================================================================

export class ClientRenderer {
  private state: RendererState
  private callbacks: RendererCallbacks
  private eventQueue: RenderEvent[] = []
  private isProcessing = false

  constructor(callbacks: RendererCallbacks) {
    this.callbacks = callbacks
    this.state = this.createInitialState()
  }

  private createInitialState(): RendererState {
    return {
      streamId: null,
      chatId: null,
      isStreaming: false,
      isComplete: false,
      hasError: false,
      errorMessage: null,
      currentMessageId: null,
      content: '',
      isThinking: false,
      thinkingContent: '',
      toolCalls: new Map(),
      isCapturingPlan: false,
      planContent: '',
      planTodos: [],
      isCapturingOptions: false,
      optionsContent: '',
      options: [],
      activeSubagents: new Map(),
      pendingInterrupts: new Map(),
    }
  }

  /** Reset renderer state for a new stream */
  reset(): void {
    this.state = this.createInitialState()
    this.eventQueue = []
    this.isProcessing = false
    this.notifyStateChange()
  }

  /** Get current state (immutable copy) */
  getState(): Readonly<RendererState> {
    return { ...this.state }
  }

  /** Process a render event from the server */
  async processEvent(event: RenderEvent): Promise<void> {
    this.eventQueue.push(event)
    await this.processQueue()
  }

  /** Process multiple events (for replay) */
  async processEvents(events: RenderEvent[]): Promise<void> {
    this.eventQueue.push(...events)
    await this.processQueue()
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing) return
    this.isProcessing = true

    try {
      while (this.eventQueue.length > 0) {
        const event = this.eventQueue.shift()!
        await this.handleEvent(event)
      }
    } finally {
      this.isProcessing = false
    }
  }

  private async handleEvent(event: RenderEvent): Promise<void> {
    const type = event.type as RenderEventType

    switch (type) {
      // ========== Stream Lifecycle ==========
      case 'stream_start':
        this.handleStreamStart(event as any)
        break

      case 'stream_end':
        this.handleStreamEnd()
        break

      case 'stream_error':
        this.handleStreamError(event as any)
        break

      // ========== Message Lifecycle ==========
      case 'message_start':
        this.handleMessageStart(event as any)
        break

      case 'message_saved':
        this.handleMessageSaved(event as any)
        break

      case 'message_end':
        this.handleMessageEnd(event as any)
        break

      // ========== Text Content ==========
      case 'text_delta':
        this.handleTextDelta(event as any)
        break

      // ========== Thinking ==========
      case 'thinking_start':
        this.handleThinkingStart()
        break

      case 'thinking_delta':
        this.handleThinkingDelta(event as any)
        break

      case 'thinking_end':
        this.handleThinkingEnd()
        break

      // ========== Tool Calls ==========
      case 'tool_pending':
        this.handleToolPending(event as any)
        break

      case 'tool_generating':
        this.handleToolGenerating(event as any)
        break

      case 'tool_executing':
        this.handleToolExecuting(event as any)
        break

      case 'tool_success':
        this.handleToolSuccess(event as any)
        break

      case 'tool_error':
        this.handleToolError(event as any)
        break

      case 'tool_aborted':
        this.handleToolAborted(event as any)
        break

      // ========== Interrupts ==========
      case 'interrupt_show':
        this.handleInterruptShow(event as any)
        break

      case 'interrupt_resolved':
        this.handleInterruptResolved(event as any)
        break

      // ========== Diffs ==========
      case 'diff_ready':
        this.handleDiffReady(event as any)
        break

      // ========== Plans ==========
      case 'plan_start':
        this.handlePlanStart()
        break

      case 'plan_delta':
        this.handlePlanDelta(event as any)
        break

      case 'plan_end':
        this.handlePlanEnd(event as any)
        break

      // ========== Options ==========
      case 'options_start':
        this.handleOptionsStart()
        break

      case 'options_delta':
        this.handleOptionsDelta(event as any)
        break

      case 'options_end':
        this.handleOptionsEnd(event as any)
        break

      // ========== Subagents ==========
      case 'subagent_start':
        this.handleSubagentStart(event as any)
        break

      case 'subagent_tool_pending':
        this.handleSubagentToolPending(event as any)
        break

      case 'subagent_tool_executing':
        this.handleSubagentToolExecuting(event as any)
        break

      case 'subagent_tool_success':
        this.handleSubagentToolSuccess(event as any)
        break

      case 'subagent_tool_error':
        this.handleSubagentToolError(event as any)
        break

      case 'subagent_end':
        this.handleSubagentEnd(event as any)
        break

      // ========== Chat Metadata ==========
      case 'chat_id':
        this.state.chatId = (event as any).chatId
        this.notifyStateChange()
        break

      case 'title_updated':
        // Title updates are handled externally
        logger.debug('Title updated', { title: (event as any).title })
        break

      default:
        logger.warn('Unknown render event type', { type })
    }
  }

  // ============================================================================
  // Event Handlers
  // ============================================================================

  private handleStreamStart(event: {
    streamId: string
    chatId: string
    userMessageId: string
    assistantMessageId: string
  }): void {
    this.state.streamId = event.streamId
    this.state.chatId = event.chatId
    this.state.currentMessageId = event.assistantMessageId
    this.state.isStreaming = true
    this.state.isComplete = false
    this.state.hasError = false
    this.notifyStateChange()
  }

  private handleStreamEnd(): void {
    this.state.isStreaming = false
    this.state.isComplete = true
    this.notifyStateChange()
    this.callbacks.onStreamComplete?.()
  }

  private handleStreamError(event: { error: string }): void {
    this.state.isStreaming = false
    this.state.hasError = true
    this.state.errorMessage = event.error
    this.notifyStateChange()
    this.callbacks.onStreamError?.(event.error)
  }

  private handleMessageStart(event: { messageId: string; role: string }): void {
    if (event.role === 'assistant') {
      this.state.currentMessageId = event.messageId
      this.state.content = ''
    }
    this.notifyStateChange()
  }

  private handleMessageSaved(event: { messageId: string; refreshFromDb?: boolean }): void {
    logger.debug('Message saved', { messageId: event.messageId, refresh: event.refreshFromDb })
    // If refreshFromDb is true, the message was saved with special state (like diff markers)
    // The client should refresh from DB to get the latest state
  }

  private handleMessageEnd(event: { messageId: string }): void {
    logger.debug('Message end', { messageId: event.messageId })
  }

  private handleTextDelta(event: { content: string }): void {
    this.state.content += event.content
    this.notifyStateChange()
  }

  private handleThinkingStart(): void {
    this.state.isThinking = true
    this.state.thinkingContent = ''
    this.notifyStateChange()
  }

  private handleThinkingDelta(event: { content: string }): void {
    this.state.thinkingContent += event.content
    this.notifyStateChange()
  }

  private handleThinkingEnd(): void {
    this.state.isThinking = false
    this.notifyStateChange()
  }

  private handleToolPending(event: {
    toolCallId: string
    toolName: string
    args: Record<string, unknown>
    display: { label: string; description?: string }
  }): void {
    this.state.toolCalls.set(event.toolCallId, {
      id: event.toolCallId,
      name: event.toolName,
      args: event.args,
      status: 'pending',
      display: event.display,
    })
    this.notifyStateChange()
  }

  private handleToolGenerating(event: {
    toolCallId: string
    argsPartial?: Record<string, unknown>
  }): void {
    const tool = this.state.toolCalls.get(event.toolCallId)
    if (tool) {
      tool.status = 'generating'
      if (event.argsPartial) {
        tool.args = event.argsPartial
      }
    }
    this.notifyStateChange()
  }

  private handleToolExecuting(event: { toolCallId: string }): void {
    const tool = this.state.toolCalls.get(event.toolCallId)
    if (tool) {
      tool.status = 'executing'
    }
    this.notifyStateChange()
  }

  private handleToolSuccess(event: {
    toolCallId: string
    result?: unknown
    display?: { label: string; description?: string }
    workflowId?: string
    hasDiff?: boolean
  }): void {
    const tool = this.state.toolCalls.get(event.toolCallId)
    if (tool) {
      tool.status = 'success'
      tool.result = event.result
      if (event.display) {
        tool.display = event.display
      }
    }
    this.notifyStateChange()
  }

  private handleToolError(event: {
    toolCallId: string
    error: string
    display?: { label: string; description?: string }
  }): void {
    const tool = this.state.toolCalls.get(event.toolCallId)
    if (tool) {
      tool.status = 'error'
      tool.error = event.error
      if (event.display) {
        tool.display = event.display
      }
    }
    this.notifyStateChange()
  }

  private handleToolAborted(event: { toolCallId: string; reason?: string }): void {
    const tool = this.state.toolCalls.get(event.toolCallId)
    if (tool) {
      tool.status = 'aborted'
      tool.error = event.reason
    }
    this.notifyStateChange()
  }

  private handleInterruptShow(event: {
    toolCallId: string
    toolName: string
    options: Array<{
      id: string
      label: string
      description?: string
      variant?: 'default' | 'destructive' | 'outline'
    }>
    message?: string
  }): void {
    this.state.pendingInterrupts.set(event.toolCallId, {
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      options: event.options,
      message: event.message,
    })
    this.notifyStateChange()
    this.callbacks.onInterruptRequired?.({
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      options: event.options,
      message: event.message,
    })
  }

  private handleInterruptResolved(event: {
    toolCallId: string
    choice: string
    approved: boolean
  }): void {
    this.state.pendingInterrupts.delete(event.toolCallId)
    this.notifyStateChange()
  }

  private handleDiffReady(event: { workflowId: string; toolCallId: string }): void {
    this.callbacks.onDiffReady?.(event.workflowId, event.toolCallId)
  }

  private handlePlanStart(): void {
    this.state.isCapturingPlan = true
    this.state.planContent = ''
    this.notifyStateChange()
  }

  private handlePlanDelta(event: { content: string }): void {
    this.state.planContent += event.content
    this.notifyStateChange()
  }

  private handlePlanEnd(event: { todos: PlanTodo[] }): void {
    this.state.isCapturingPlan = false
    this.state.planTodos = event.todos
    this.notifyStateChange()
  }

  private handleOptionsStart(): void {
    this.state.isCapturingOptions = true
    this.state.optionsContent = ''
    this.notifyStateChange()
  }

  private handleOptionsDelta(event: { content: string }): void {
    this.state.optionsContent += event.content
    this.notifyStateChange()
  }

  private handleOptionsEnd(event: { options: string[] }): void {
    this.state.isCapturingOptions = false
    this.state.options = event.options
    this.notifyStateChange()
  }

  private handleSubagentStart(event: {
    parentToolCallId: string
    subagentId: string
    label?: string
  }): void {
    this.state.activeSubagents.set(event.parentToolCallId, {
      parentToolCallId: event.parentToolCallId,
      subagentId: event.subagentId,
      label: event.label,
      toolCalls: new Map(),
    })
    this.notifyStateChange()
  }

  private handleSubagentToolPending(event: {
    parentToolCallId: string
    toolCallId: string
    toolName: string
    args: Record<string, unknown>
    display: { label: string; description?: string }
  }): void {
    const subagent = this.state.activeSubagents.get(event.parentToolCallId)
    if (subagent) {
      subagent.toolCalls.set(event.toolCallId, {
        id: event.toolCallId,
        name: event.toolName,
        args: event.args,
        status: 'pending',
        display: event.display,
      })
    }
    this.notifyStateChange()
  }

  private handleSubagentToolExecuting(event: {
    parentToolCallId: string
    toolCallId: string
  }): void {
    const subagent = this.state.activeSubagents.get(event.parentToolCallId)
    if (subagent) {
      const tool = subagent.toolCalls.get(event.toolCallId)
      if (tool) {
        tool.status = 'executing'
      }
    }
    this.notifyStateChange()
  }

  private handleSubagentToolSuccess(event: {
    parentToolCallId: string
    toolCallId: string
    result?: unknown
    display?: { label: string; description?: string }
  }): void {
    const subagent = this.state.activeSubagents.get(event.parentToolCallId)
    if (subagent) {
      const tool = subagent.toolCalls.get(event.toolCallId)
      if (tool) {
        tool.status = 'success'
        tool.result = event.result
        if (event.display) {
          tool.display = event.display
        }
      }
    }
    this.notifyStateChange()
  }

  private handleSubagentToolError(event: {
    parentToolCallId: string
    toolCallId: string
    error: string
  }): void {
    const subagent = this.state.activeSubagents.get(event.parentToolCallId)
    if (subagent) {
      const tool = subagent.toolCalls.get(event.toolCallId)
      if (tool) {
        tool.status = 'error'
        tool.error = event.error
      }
    }
    this.notifyStateChange()
  }

  private handleSubagentEnd(event: { parentToolCallId: string }): void {
    // Keep subagent data for display, just mark as complete
    logger.debug('Subagent ended', { parentToolCallId: event.parentToolCallId })
    this.notifyStateChange()
  }

  private notifyStateChange(): void {
    this.callbacks.onStateChange(this.getState())
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse a render event from an SSE data line
 */
export function parseRenderEvent(line: string): RenderEvent | null {
  if (!line.startsWith('data: ')) return null
  try {
    return JSON.parse(line.slice(6)) as RenderEvent
  } catch {
    return null
  }
}

/**
 * Stream events from an SSE endpoint and process them
 */
export async function streamRenderEvents(
  url: string,
  renderer: ClientRenderer,
  options?: {
    signal?: AbortSignal
    onConnect?: () => void
    onError?: (error: Error) => void
  }
): Promise<void> {
  const response = await fetch(url, {
    headers: { Accept: 'text/event-stream' },
    signal: options?.signal,
  })

  if (!response.ok) {
    const error = new Error(`Stream failed: ${response.status}`)
    options?.onError?.(error)
    throw error
  }

  options?.onConnect?.()

  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('No response body')
  }

  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const event = parseRenderEvent(line)
        if (event) {
          await renderer.processEvent(event)
        }
      }
    }

    // Process remaining buffer
    if (buffer) {
      const event = parseRenderEvent(buffer)
      if (event) {
        await renderer.processEvent(event)
      }
    }
  } finally {
    reader.releaseLock()
  }
}

