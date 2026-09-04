import type { AsyncCompletionSignal } from '@/lib/mothership/async-runs/lifecycle'
import {
  type MothershipStreamV1CompletionStatus,
  MothershipStreamV1ToolOutcome,
} from '@/lib/mothership/generated/mothership-stream-v1'
import type { RequestTraceV1Span } from '@/lib/mothership/generated/request-trace-v1'
import type { StreamEvent } from '@/lib/mothership/request/session'
import type { TraceCollector } from '@/lib/mothership/request/trace'
import type {
  ToolExecutionContext,
  ToolExecutionResult,
} from '@/lib/mothership/tool-executor/types'

export type { StreamEvent }

export type LocalToolCallStatus = 'pending' | 'executing' | 'awaiting_approval'
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
  /** The model's tool name when `name` is a display identity (the worker's cli_*
   * names). Execution dispatches on this; rendering and persistence keep `name`. */
  execName?: string
  status: ToolCallStatus
  /** Bounded registry ID of the agent that invoked this tool. */
  agentId?: string
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
   * prepare_file_edit -> apply_file_edit intent handoff per file subagent. Undefined
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
  plan: 'plan',
  task: 'task',
} as const

/**
 * A background task the turn armed (the worker's `run`/`task_armed` frame): the pill
 * under the turn. `status`/`summary` arrive with `task_delivered` when the task's
 * notification is steered into this same turn; a wake-delivered one resolves on reload.
 */
export interface TaskBlockInfo {
  taskId: string
  kind: 'timer' | 'workflow_run'
  target: Record<string, unknown>
  note: string
  status?: 'pending' | 'completed' | 'failed' | 'stopped' | 'expired'
  summary?: string
}

/** One step of the agent's visible plan (the worker's `plan` frame payload). */
export interface AgentPlanItem {
  step: string
  status: 'pending' | 'active' | 'done'
}
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
  /** Orchestrator-chosen display name for a `subagent` start block. */
  subagentName?: string
  /**
   * Deterministic agent-run identity. `spanId` is the stable per-invocation id
   * of the subagent that produced the block; `parentSpanId` links it to the run
   * that invoked it. These are the primary nesting keys; `parentToolCallId` is
   * retained for tool linkage and legacy back-compat.
   */
  spanId?: string
  parentSpanId?: string
  /** The agent's current plan (plan blocks only); whole-list, latest wins. */
  planItems?: AgentPlanItem[]
  /** The background task this block announces (task blocks only). */
  task?: TaskBlockInfo
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
  /**
   * Tool-frame dedupe for THIS turn (retransmits across a turn's retry/resume legs).
   * Turn-scoped lifecycle sets — they die with the context. Was process-global with a
   * shared 1000-entry cap: under load one stream's frames evicted another's dedupe state.
   */
  seenToolCalls: Set<string>
  seenToolResults: Set<string>
  awaitingAsyncContinuation?: ResumeContinuation
  currentThinkingBlock: ContentBlock | null
  /**
   * Open subagent "thinking" blocks, keyed by parentToolCallId (one lane per
   * concurrent subagent). Was a single slot, which collided when two subagents
   * streamed thinking concurrently — interleaved chunks flushed each other's
   * block. Per-lane keying keeps each subagent's reasoning intact.
   */
  subagentThinkingBlocks: Map<string, ContentBlock>
  /** Span ids whose lane start block has been persisted (dedupe across replays). */
  openSubagentSpans?: Set<string>
  isInThinkingBlock: boolean
  subAgentContent: Record<string, string>
  subAgentToolCalls: Record<string, ToolCallState[]>
  openSubagentParents?: Set<string>
  pendingContent: string
  streamComplete: boolean
  wasAborted: boolean
  errors: string[]
  /**
   * Terminal status carried by the backend's `complete` event. Set only once
   * the backend declares the turn finished, so it can outrank in-band failures
   * recorded on the way there (a tool or subagent that failed and was handed
   * back to the model as data).
   */
  completionStatus?: MothershipStreamV1CompletionStatus
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
  /**
   * Per-request state for the tool permission gate. `autoAllowed` starts from
   * the user's saved always-allow list and is added to in place when they pick
   * "always allow" mid-turn, so a later call to the same tool in this same turn
   * is not prompted a second time.
   */
  toolPermissions: {
    enabled: boolean
    autoAllowed: Set<string>
  }
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
  version?: string
  prefetch?: boolean
  userName?: string
}

export interface OrchestratorOptions {
  autoExecuteTools?: boolean
  timeout?: number
  onEvent?: (event: StreamEvent) => void | Promise<void>
  /**
   * Whether the per-event macrotask yield (which lets Node flush the HTTP response buffer)
   * should run. The sink owner sets this: legs with no client response attached have
   * nothing to flush, and the yield only slows the forwarder. Defaults to true.
   */
  flushAfterEvent?: boolean
  onComplete?: (result: OrchestratorResult) => void | Promise<void>
  onError?: (error: Error, result?: OrchestratorResult) => void | Promise<void>
  abortSignal?: AbortSignal
  onAbortObserved?: (reason: string) => void
  interactive?: boolean
  /**
   * Whether the caller declared it can pick up client-routed workflow tools
   * (ChatRequest.clientCapabilities). false → dispatch claims and runs them
   * server-side immediately instead of waiting out the client-pickup grace.
   * Defaults true (legacy callers made no declaration). Orthogonal to
   * `interactive`, which is a trust classification, not executor routing.
   */
  clientToolPickupExpected?: boolean
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
