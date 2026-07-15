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
  /** Model-authored activity text for a gateway-resolved integration call. */
  integrationDescription?: string
  /** Accumulated partial JSON of the arguments while the model streams them. */
  streamingArgs?: string
  params?: Record<string, unknown>
  result?: ToolCallStateResult
  error?: string
  startTime?: number
  endTime?: number
  /**
   * For a subagent-scoped tool call, the invoking subagent's channel id (its
   * outer tool_use id, = event.scope.parentToolCallId). Captured at dispatch so
   * the executor can thread it into the server tool context and scope the
   * workspace_file -> edit_content intent handoff per file subagent. Undefined
   * for main-lane tool calls.
   */
  parentToolCallId?: string
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
  parentToolCallId?: string
  /**
   * Subagent name for lane blocks (from the event scope's agentId). Persisted
   * so a reloaded transcript can rebuild the lane's group even when the
   * `subagent` start block is missing (resume legs re-emit text without start).
   */
  subagent?: string
  /**
   * Deterministic agent-run identity. `spanId` is the stable per-invocation id
   * of the subagent that produced the block; `parentSpanId` links it to the run
   * that invoked it. These are the primary nesting keys; `parentToolCallId` is
   * retained for tool linkage and legacy back-compat.
   */
  spanId?: string
  parentSpanId?: string
}

export interface ActiveFileIntent {
  toolCallId: string
  operation: string
  target: { kind: string; fileId?: string; fileName?: string; path?: string }
  title?: string
  contentType?: string
  edit?: Record<string, unknown>
}

// One paused subagent frame in an async continuation. Mirrors the wire
// MothershipStreamV1CheckpointPauseFrame the run handler maps from, but is the
// internal shape the resume driver consumes (named once here so the lifecycle
// driver and handlers reference the same type instead of re-declaring it inline).
export interface ResumeFrame {
  parentToolCallId: string
  parentToolName: string
  pendingToolIds: string[]
  // Per-subagent checkpoint model: this frame's OWN checkpoint chain. When set,
  // the resume loop must POST /api/tools/resume with THIS id (not the top-level
  // checkpointId) carrying only this frame's leaf results, and may drive the N
  // frames concurrently. Empty under the bundled-frame model.
  checkpointId?: string
}

// The async-continuation state captured from a checkpoint_pause: what the resume
// loop needs to drive the next /resume (the bundled top-level id + pending tools,
// or per-subagent frames each carrying their own checkpointId).
export interface ResumeContinuation {
  checkpointId: string
  executionId?: string
  runId?: string
  pendingToolCallIds: string[]
  frames?: ResumeFrame[]
}

export interface StreamingContext {
  chatId?: string
  requestId?: string
  executionId?: string
  runId?: string
  messageId: string
  accumulatedContent: string
  finalAssistantContent: string
  sawMainToolCall: boolean
  contentBlocks: ContentBlock[]
  toolCalls: Map<string, ToolCallState>
  pendingToolPromises: Map<string, Promise<AsyncCompletionSignal>>
  awaitingAsyncContinuation?: ResumeContinuation
  currentThinkingBlock: ContentBlock | null
  /**
   * Open subagent "thinking" blocks, keyed by parentToolCallId (one lane per
   * concurrent subagent). Was a single slot, which collided when two subagents
   * streamed thinking concurrently — interleaved chunks flushed each other's
   * block. Per-lane keying keeps each subagent's reasoning intact.
   */
  subagentThinkingBlocks: Map<string, ContentBlock>
  isInThinkingBlock: boolean
  subAgentContent: Record<string, string>
  subAgentToolCalls: Record<string, ToolCallState[]>
  openSubagentParents?: Set<string>
  pendingContent: string
  streamComplete: boolean
  wasAborted: boolean
  errors: string[]
  usage?: { prompt: number; completion: number }
  cost?: { input: number; output: number; total: number }
  /**
   * In-flight file-write intents keyed by the file subagent's channel id
   * (event.scope.parentToolCallId). Was a single slot, which cross-attributed
   * streamed content when two file subagents wrote concurrently; per-channel
   * keying isolates each agent's preview. The empty-string key holds the
   * main-lane / no-scope intent (file writes there are always sequential).
   */
  activeFileIntents: Map<string, ActiveFileIntent>
  trace: TraceCollector
  subAgentTraceSpans?: Map<string, RequestTraceV1Span>
}

interface FileAttachment {
  id: string
  key: string
  name: string
  mimeType: string
  size: number
}

interface OrchestratorRequest {
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
  onError?: (error: Error, result?: OrchestratorResult) => void | Promise<void>
  abortSignal?: AbortSignal
  onAbortObserved?: (reason: string) => void
  interactive?: boolean
}

export interface OrchestratorResult {
  success: boolean
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
