import type { AsyncCompletionSignal } from '@/lib/copilot/async-runs/lifecycle'
import { MothershipStreamV1ToolOutcome } from '@/lib/copilot/generated/mothership-stream-v1'
import type { RequestTraceV1Span } from '@/lib/copilot/generated/request-trace-v1'
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
  endedAt?: number
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
  subAgentTraceSpans?: Map<string, RequestTraceV1Span>
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
  /**
   * Invoked when the orchestrator infers that the run was aborted via
   * an out-of-band signal (currently: a Redis abort marker observed
   * at SSE body close). Callers wire this to fire their local
   * `AbortController` so `signal.reason` is set and `recordCancelled`
   * classifies as `explicit_stop` rather than `unknown`.
   */
  onAbortObserved?: (reason: string) => void
  interactive?: boolean
}

export interface OrchestratorResult {
  success: boolean
  /**
   * True iff the non-success outcome was a user-initiated cancel
   * (abort signal fired or client disconnected). Lets callers treat
   * cancels differently from actual errors — notably, `buildOnComplete`
   * must NOT finalize the chat row on cancel, because the browser's
   * `/api/copilot/chat/stop` POST owns writing the partial assistant
   * content and clearing `conversationId` in one UPDATE. Finalizing
   * here would race and clear `conversationId` first, making the stop
   * UPDATE match zero rows and the partial content vanish on refetch.
   *
   * Always false when `success=true`.
   */
  cancelled?: boolean
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
