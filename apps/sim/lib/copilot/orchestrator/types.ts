import type { MothershipResource } from '@/lib/copilot/resource-types'

export type SSEEventType =
  | 'chat_id'
  | 'request_id'
  | 'title_updated'
  | 'content'
  | 'reasoning'
  | 'tool_call'
  | 'tool_call_delta'
  | 'tool_generating'
  | 'tool_result'
  | 'tool_error'
  | 'resource_added'
  | 'resource_deleted'
  | 'subagent_start'
  | 'subagent_end'
  | 'structured_result'
  | 'subagent_result'
  | 'done'
  | 'error'
  | 'start'

export interface SSEEvent {
  type: SSEEventType
  /** Authoritative tool call state set by the Go backend */
  state?: string
  data?: Record<string, unknown>
  /** Parent agent that produced this event */
  agent?: string
  /** Subagent identifier (e.g. "build", "fast_edit") */
  subagent?: string
  toolCallId?: string
  toolName?: string
  success?: boolean
  result?: unknown
  /** Set on chat_id events */
  chatId?: string
  /** Set on title_updated events */
  title?: string
  /** Set on error events */
  error?: string
  /** Set on content/reasoning events */
  content?: string
  /** Set on reasoning events */
  phase?: string
  /** UI metadata from copilot (title, icon, phaseLabel) */
  ui?: Record<string, unknown>
  /** Set on resource_added events */
  resource?: { type: string; id: string; title: string }
}

export type ToolCallStatus =
  | 'pending'
  | 'executing'
  | 'success'
  | 'error'
  | 'skipped'
  | 'rejected'
  | 'cancelled'

const TERMINAL_TOOL_STATUSES: ReadonlySet<ToolCallStatus> = new Set([
  'success',
  'error',
  'cancelled',
  'skipped',
  'rejected',
])

export function isTerminalToolCallStatus(status?: string): boolean {
  return TERMINAL_TOOL_STATUSES.has(status as ToolCallStatus)
}

export interface ToolCallState {
  id: string
  name: string
  status: ToolCallStatus
  params?: Record<string, unknown>
  result?: ToolCallResult
  error?: string
  startTime?: number
  endTime?: number
}

export interface ToolCallResult<T = unknown> {
  success: boolean
  output?: T
  error?: string
  resources?: MothershipResource[]
}

export type ContentBlockType = 'text' | 'thinking' | 'tool_call' | 'subagent_text' | 'subagent'

export interface ContentBlock {
  type: ContentBlockType
  content?: string
  toolCall?: ToolCallState
  calledBy?: string
  timestamp: number
}

export interface StreamingContext {
  chatId?: string
  requestId?: string
  executionId?: string
  runId?: string
  messageId: string
  accumulatedContent: string
  contentBlocks: ContentBlock[]
  toolCalls: Map<string, ToolCallState>
  pendingToolPromises: Map<
    string,
    Promise<{ status: string; message?: string; data?: Record<string, unknown> }>
  >
  awaitingAsyncContinuation?: {
    checkpointId: string
    executionId?: string
    runId?: string
    pendingToolCallIds: string[]
  }
  currentThinkingBlock: ContentBlock | null
  isInThinkingBlock: boolean
  subAgentParentToolCallId?: string
  subAgentParentStack: string[]
  subAgentContent: Record<string, string>
  subAgentToolCalls: Record<string, ToolCallState[]>
  pendingContent: string
  streamComplete: boolean
  wasAborted: boolean
  errors: string[]
  usage?: { prompt: number; completion: number }
  cost?: { input: number; output: number; total: number }
}

export interface FileAttachment {
  id: string
  key: string
  name: string
  mimeType: string
  size: number
}

export interface OrchestratorRequest {
  message: string
  workflowId: string
  userId: string
  chatId?: string
  mode?: 'agent' | 'ask' | 'plan'
  model?: string
  contexts?: Array<{ type: string; content: string }>
  fileAttachments?: FileAttachment[]
  commands?: string[]
  provider?: string
  streamToolCalls?: boolean
  version?: string
  prefetch?: boolean
  userName?: string
}

export interface OrchestratorOptions {
  autoExecuteTools?: boolean
  timeout?: number
  onEvent?: (event: SSEEvent) => void | Promise<void>
  onComplete?: (result: OrchestratorResult) => void | Promise<void>
  onError?: (error: Error) => void | Promise<void>
  abortSignal?: AbortSignal
  interactive?: boolean
}

export interface OrchestratorResult {
  success: boolean
  content: string
  contentBlocks: ContentBlock[]
  toolCalls: ToolCallSummary[]
  chatId?: string
  requestId?: string
  error?: string
  errors?: string[]
  usage?: { prompt: number; completion: number }
  cost?: { input: number; output: number; total: number }
}

export interface ToolCallSummary {
  id: string
  name: string
  status: ToolCallStatus
  params?: Record<string, unknown>
  result?: unknown
  error?: string
  durationMs?: number
}

export interface ExecutionContext {
  userId: string
  workflowId: string
  workspaceId?: string
  chatId?: string
  executionId?: string
  runId?: string
  abortSignal?: AbortSignal
  userTimezone?: string
  userPermission?: string
  decryptedEnvVars?: Record<string, string>
}
