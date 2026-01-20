/**
 * Render Events - Server → Client SSE Protocol
 *
 * This defines the SSE event protocol between the copilot server and client.
 * The server processes the raw Sim Agent stream, executes tools, persists to DB,
 * and emits these render events. The client just renders based on these events.
 *
 * Benefits:
 * - Client is purely a renderer (no parsing, no execution)
 * - Persistence happens before render (safe to refresh anytime)
 * - Works identically with or without a client (API-only mode)
 * - Resume is just replaying render events
 */

// ============================================================================
// Base Types
// ============================================================================

export interface BaseRenderEvent {
  type: RenderEventType
  /** Monotonically increasing sequence number for ordering */
  seq: number
  /** Timestamp when event was created */
  ts: number
}

export type RenderEventType =
  // Stream lifecycle
  | 'stream_start'
  | 'stream_end'
  | 'stream_error'

  // Message lifecycle
  | 'message_start'
  | 'message_saved'
  | 'message_end'

  // Text content
  | 'text_delta'

  // Thinking blocks
  | 'thinking_start'
  | 'thinking_delta'
  | 'thinking_end'

  // Tool calls
  | 'tool_pending'
  | 'tool_generating'
  | 'tool_executing'
  | 'tool_success'
  | 'tool_error'
  | 'tool_aborted'

  // Interrupts (user approval needed)
  | 'interrupt_show'
  | 'interrupt_resolved'

  // Workflow diffs
  | 'diff_ready'
  | 'diff_accepted'
  | 'diff_rejected'

  // Plans
  | 'plan_start'
  | 'plan_delta'
  | 'plan_end'

  // Options (continue/follow-up suggestions)
  | 'options_start'
  | 'options_delta'
  | 'options_end'

  // Subagents
  | 'subagent_start'
  | 'subagent_tool_pending'
  | 'subagent_tool_generating'
  | 'subagent_tool_executing'
  | 'subagent_tool_success'
  | 'subagent_tool_error'
  | 'subagent_end'

  // Chat metadata
  | 'chat_id'
  | 'title_updated'

// ============================================================================
// Stream Lifecycle Events
// ============================================================================

export interface StreamStartEvent extends BaseRenderEvent {
  type: 'stream_start'
  streamId: string
  chatId: string
  userMessageId: string
  assistantMessageId: string
}

export interface StreamEndEvent extends BaseRenderEvent {
  type: 'stream_end'
}

export interface StreamErrorEvent extends BaseRenderEvent {
  type: 'stream_error'
  error: string
  code?: string
}

// ============================================================================
// Message Lifecycle Events
// ============================================================================

export interface MessageStartEvent extends BaseRenderEvent {
  type: 'message_start'
  messageId: string
  role: 'user' | 'assistant'
}

export interface MessageSavedEvent extends BaseRenderEvent {
  type: 'message_saved'
  messageId: string
  /** If true, client should refresh message from DB (contains diff markers, etc.) */
  refreshFromDb?: boolean
}

export interface MessageEndEvent extends BaseRenderEvent {
  type: 'message_end'
  messageId: string
}

// ============================================================================
// Text Content Events
// ============================================================================

export interface TextDeltaEvent extends BaseRenderEvent {
  type: 'text_delta'
  content: string
}

// ============================================================================
// Thinking Block Events
// ============================================================================

export interface ThinkingStartEvent extends BaseRenderEvent {
  type: 'thinking_start'
}

export interface ThinkingDeltaEvent extends BaseRenderEvent {
  type: 'thinking_delta'
  content: string
}

export interface ThinkingEndEvent extends BaseRenderEvent {
  type: 'thinking_end'
}

// ============================================================================
// Tool Call Events
// ============================================================================

export interface ToolDisplay {
  label: string
  description?: string
  icon?: string
}

export interface ToolPendingEvent extends BaseRenderEvent {
  type: 'tool_pending'
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  display: ToolDisplay
}

export interface ToolGeneratingEvent extends BaseRenderEvent {
  type: 'tool_generating'
  toolCallId: string
  /** Partial args as they stream in */
  argsDelta?: string
  /** Full args so far */
  argsPartial?: Record<string, unknown>
}

export interface ToolExecutingEvent extends BaseRenderEvent {
  type: 'tool_executing'
  toolCallId: string
  display?: ToolDisplay
}

export interface ToolSuccessEvent extends BaseRenderEvent {
  type: 'tool_success'
  toolCallId: string
  result?: unknown
  display?: ToolDisplay
  /** For edit_workflow: tells client to read diff from DB */
  workflowId?: string
  hasDiff?: boolean
}

export interface ToolErrorEvent extends BaseRenderEvent {
  type: 'tool_error'
  toolCallId: string
  error: string
  display?: ToolDisplay
}

export interface ToolAbortedEvent extends BaseRenderEvent {
  type: 'tool_aborted'
  toolCallId: string
  reason?: string
  display?: ToolDisplay
}

// ============================================================================
// Interrupt Events (User Approval)
// ============================================================================

export interface InterruptOption {
  id: string
  label: string
  description?: string
  variant?: 'default' | 'destructive' | 'outline'
}

export interface InterruptShowEvent extends BaseRenderEvent {
  type: 'interrupt_show'
  toolCallId: string
  toolName: string
  options: InterruptOption[]
  /** Optional message to display */
  message?: string
}

export interface InterruptResolvedEvent extends BaseRenderEvent {
  type: 'interrupt_resolved'
  toolCallId: string
  choice: string
  /** Whether to continue execution */
  approved: boolean
}

// ============================================================================
// Workflow Diff Events
// ============================================================================

export interface DiffReadyEvent extends BaseRenderEvent {
  type: 'diff_ready'
  workflowId: string
  toolCallId: string
  /** Client should read workflow state from DB which contains diff markers */
}

export interface DiffAcceptedEvent extends BaseRenderEvent {
  type: 'diff_accepted'
  workflowId: string
}

export interface DiffRejectedEvent extends BaseRenderEvent {
  type: 'diff_rejected'
  workflowId: string
}

// ============================================================================
// Plan Events
// ============================================================================

export interface PlanTodo {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

export interface PlanStartEvent extends BaseRenderEvent {
  type: 'plan_start'
}

export interface PlanDeltaEvent extends BaseRenderEvent {
  type: 'plan_delta'
  content: string
}

export interface PlanEndEvent extends BaseRenderEvent {
  type: 'plan_end'
  todos: PlanTodo[]
}

// ============================================================================
// Options Events (Follow-up Suggestions)
// ============================================================================

export interface OptionsStartEvent extends BaseRenderEvent {
  type: 'options_start'
}

export interface OptionsDeltaEvent extends BaseRenderEvent {
  type: 'options_delta'
  content: string
}

export interface OptionsEndEvent extends BaseRenderEvent {
  type: 'options_end'
  options: string[]
}

// ============================================================================
// Subagent Events
// ============================================================================

export interface SubagentStartEvent extends BaseRenderEvent {
  type: 'subagent_start'
  parentToolCallId: string
  subagentId: string
  label?: string
}

export interface SubagentToolPendingEvent extends BaseRenderEvent {
  type: 'subagent_tool_pending'
  parentToolCallId: string
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  display: ToolDisplay
}

export interface SubagentToolGeneratingEvent extends BaseRenderEvent {
  type: 'subagent_tool_generating'
  parentToolCallId: string
  toolCallId: string
  argsDelta?: string
}

export interface SubagentToolExecutingEvent extends BaseRenderEvent {
  type: 'subagent_tool_executing'
  parentToolCallId: string
  toolCallId: string
}

export interface SubagentToolSuccessEvent extends BaseRenderEvent {
  type: 'subagent_tool_success'
  parentToolCallId: string
  toolCallId: string
  result?: unknown
  display?: ToolDisplay
}

export interface SubagentToolErrorEvent extends BaseRenderEvent {
  type: 'subagent_tool_error'
  parentToolCallId: string
  toolCallId: string
  error: string
}

export interface SubagentEndEvent extends BaseRenderEvent {
  type: 'subagent_end'
  parentToolCallId: string
}

// ============================================================================
// Chat Metadata Events
// ============================================================================

export interface ChatIdEvent extends BaseRenderEvent {
  type: 'chat_id'
  chatId: string
}

export interface TitleUpdatedEvent extends BaseRenderEvent {
  type: 'title_updated'
  title: string
}

// ============================================================================
// Union Type
// ============================================================================

export type RenderEvent =
  // Stream lifecycle
  | StreamStartEvent
  | StreamEndEvent
  | StreamErrorEvent
  // Message lifecycle
  | MessageStartEvent
  | MessageSavedEvent
  | MessageEndEvent
  // Text content
  | TextDeltaEvent
  // Thinking
  | ThinkingStartEvent
  | ThinkingDeltaEvent
  | ThinkingEndEvent
  // Tool calls
  | ToolPendingEvent
  | ToolGeneratingEvent
  | ToolExecutingEvent
  | ToolSuccessEvent
  | ToolErrorEvent
  | ToolAbortedEvent
  // Interrupts
  | InterruptShowEvent
  | InterruptResolvedEvent
  // Diffs
  | DiffReadyEvent
  | DiffAcceptedEvent
  | DiffRejectedEvent
  // Plans
  | PlanStartEvent
  | PlanDeltaEvent
  | PlanEndEvent
  // Options
  | OptionsStartEvent
  | OptionsDeltaEvent
  | OptionsEndEvent
  // Subagents
  | SubagentStartEvent
  | SubagentToolPendingEvent
  | SubagentToolGeneratingEvent
  | SubagentToolExecutingEvent
  | SubagentToolSuccessEvent
  | SubagentToolErrorEvent
  | SubagentEndEvent
  // Chat metadata
  | ChatIdEvent
  | TitleUpdatedEvent

// ============================================================================
// Helper Functions
// ============================================================================

let seqCounter = 0

/**
 * Create a render event with auto-incrementing sequence number
 */
export function createRenderEvent<T extends RenderEventType>(
  type: T,
  data: Omit<Extract<RenderEvent, { type: T }>, 'type' | 'seq' | 'ts'>
): Extract<RenderEvent, { type: T }> {
  return {
    type,
    seq: ++seqCounter,
    ts: Date.now(),
    ...data,
  } as Extract<RenderEvent, { type: T }>
}

/**
 * Reset sequence counter (for testing or new streams)
 */
export function resetSeqCounter(): void {
  seqCounter = 0
}

/**
 * Serialize a render event to SSE format
 */
export function serializeRenderEvent(event: RenderEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

/**
 * Parse a render event from SSE data line
 */
export function parseRenderEvent(line: string): RenderEvent | null {
  if (!line.startsWith('data: ')) return null
  try {
    return JSON.parse(line.slice(6)) as RenderEvent
  } catch {
    return null
  }
}

