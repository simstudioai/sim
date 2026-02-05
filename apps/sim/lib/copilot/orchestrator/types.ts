import type { CopilotProviderConfig } from '@/lib/copilot/types'

export type SSEEventType =
  | 'chat_id'
  | 'title_updated'
  | 'content'
  | 'reasoning'
  | 'tool_call'
  | 'tool_generating'
  | 'tool_result'
  | 'tool_error'
  | 'subagent_start'
  | 'subagent_end'
  | 'structured_result'
  | 'subagent_result'
  | 'done'
  | 'error'
  | 'start'

export interface SSEEvent {
  type: SSEEventType
  data?: unknown
  subagent?: string
  toolCallId?: string
  toolName?: string
  success?: boolean
  result?: unknown
}

export type ToolCallStatus = 'pending' | 'executing' | 'success' | 'error' | 'skipped' | 'rejected'

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
}

export type ContentBlockType = 'text' | 'thinking' | 'tool_call' | 'subagent_text'

export interface ContentBlock {
  type: ContentBlockType
  content?: string
  toolCall?: ToolCallState
  timestamp: number
}

export interface StreamingContext {
  chatId?: string
  conversationId?: string
  messageId: string
  accumulatedContent: string
  contentBlocks: ContentBlock[]
  toolCalls: Map<string, ToolCallState>
  currentThinkingBlock: ContentBlock | null
  isInThinkingBlock: boolean
  subAgentParentToolCallId?: string
  subAgentContent: Record<string, string>
  subAgentToolCalls: Record<string, ToolCallState[]>
  pendingContent: string
  streamComplete: boolean
  wasAborted: boolean
  errors: string[]
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
  conversationId?: string
  contexts?: Array<{ type: string; content: string }>
  fileAttachments?: FileAttachment[]
  commands?: string[]
  provider?: CopilotProviderConfig
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
  conversationId?: string
  error?: string
  errors?: string[]
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
  decryptedEnvVars?: Record<string, string>
}
