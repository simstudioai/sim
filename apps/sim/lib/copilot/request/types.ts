import type { AsyncCompletionSignal } from '@/lib/copilot/async-runs/lifecycle'
import { MothershipStreamV1ToolOutcome } from '@/lib/copilot/generated/mothership-stream-v1'
import type { StreamEvent } from '@/lib/copilot/request/session'
import type { TraceCollector } from '@/lib/copilot/request/trace'
import type { ToolExecutionContext, ToolExecutionResult } from '@/lib/copilot/tool-executor/types'

export type { StreamEvent }

export type LocalToolCallStatus = 'pending' | 'executing'
export type ToolCallStatus = LocalToolCallStatus | MothershipStreamV1ToolOutcome

const TERMINAL_TOOL_STATUSES: ReadonlySet<ToolCallStatus> = new Set<MothershipStreamV1ToolOutcome>(
  Object.values(MothershipStreamV1ToolOutcome)
)

export function isTerminalToolCallStatus(status?: string): boolean {
  return TERMINAL_TOOL_STATUSES.has(status as ToolCallStatus)
}

export interface ToolCallState {
  id: string
  name: string
  status: ToolCallStatus
  displayTitle?: string
  phaseLabel?: string
  params?: Record<string, unknown>
  result?: ToolCallStateResult
  error?: string
  startTime?: number
  endTime?: number
}

export type ToolCallResult<T = unknown> = ToolExecutionResult & {
  output?: T
}

export interface ToolCallStateResult<T = unknown> {
  success: boolean
  output?: T
}

export const ContentBlockType = {
  text: 'text',
  thinking: 'thinking',
  tool_call: 'tool_call',
  subagent_text: 'subagent_text',
  subagent_thinking: 'subagent_thinking',
  subagent: 'subagent',
} as const
export type ContentBlockType = (typeof ContentBlockType)[keyof typeof ContentBlockType]

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
  pendingToolPromises: Map<string, Promise<AsyncCompletionSignal>>
  awaitingAsyncContinuation?: {
    checkpointId: string
    executionId?: string
    runId?: string
    pendingToolCallIds: string[]
    frames?: Array<{
      parentToolCallId: string
      parentToolName: string
      pendingToolIds: string[]
    }>
  }
  currentThinkingBlock: ContentBlock | null
  currentSubagentThinkingBlock: ContentBlock | null
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
  activeFileIntent?: {
    toolCallId: string
    operation: string
    target: { kind: string; fileId?: string; fileName?: string }
    title?: string
    contentType?: string
    edit?: Record<string, unknown>
  } | null
  trace: TraceCollector
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
  onEvent?: (event: StreamEvent) => void | Promise<void>
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

export interface ExecutionContext extends ToolExecutionContext {
  messageId?: string
}
