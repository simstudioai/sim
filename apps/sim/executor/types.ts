import type { WorkflowExecutionAuthority, WorkflowExecutionPrincipal } from '@sim/auth/principal'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import type { TraceSpan } from '@/lib/logs/types'
import type { PermissionGroupConfig } from '@/lib/permission-groups/fields'
import type { BlockOutput } from '@/blocks/types'
import type {
  ChildWorkflowContext,
  ExecutionCallbacks,
  IterationContext,
  ParentIteration,
  PiiBlockOutputRedaction,
  SerializableExecutionState,
} from '@/executor/execution/types'
import type {
  ResolvedSecretTraceProvenanceV1,
  ResolvedSecretTraceRegistry,
} from '@/executor/utils/resolved-secret-trace-registry'
import type { RunFromBlockContext } from '@/executor/utils/run-from-block'
import type { AgentStreamSink, UnsubscribeAgentStreamSink } from '@/providers/stream-events'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'
import type { SubflowType } from '@/stores/workflows/workflow/types'

export interface UserFile {
  id: string
  name: string
  url: string
  size: number
  type: string
  key: string
  context?: string
  base64?: string
  /** Provider Files API handle (OpenAI/Anthropic `file_...` id) set when a large file is uploaded instead of inlined as base64. */
  providerFileId?: string
  /** Provider File API uri (Gemini `fileUri`) set when a large file is uploaded instead of inlined as base64. */
  providerFileUri?: string
  /** Short-lived signed HTTPS URL passed to providers that fetch attachments by remote URL instead of inlining base64. */
  remoteUrl?: string
}

export interface ParallelPauseScope {
  parallelId: string
  branchIndex: number
  branchTotal?: number
}

export interface LoopPauseScope {
  loopId: string
  iteration: number
}

export type PauseKind = 'human' | 'time'

export interface PauseMetadata {
  contextId: string
  blockId: string
  response: any
  timestamp: string
  parallelScope?: ParallelPauseScope
  loopScope?: LoopPauseScope
  resumeLinks?: {
    apiUrl: string
    uiUrl: string
    contextId: string
    executionId: string
    workflowId: string
  }
  pauseKind: PauseKind
  /** ISO timestamp at which a `pauseKind: 'time'` pause becomes due for automatic resume. */
  resumeAt?: string
}

export type ResumeStatus = 'paused' | 'resumed' | 'failed' | 'queued' | 'resuming'

export interface PausePoint {
  contextId: string
  blockId?: string
  response: any
  registeredAt: string
  resumeStatus: ResumeStatus
  automaticResumeWaitingReason?: string
  snapshotReady: boolean
  parallelScope?: ParallelPauseScope
  loopScope?: LoopPauseScope
  resumeLinks?: {
    apiUrl: string
    uiUrl: string
    contextId: string
    executionId: string
    workflowId: string
  }
  pauseKind: PauseKind
  resumeAt?: string
}

export interface SerializedSnapshot {
  snapshot: string
  triggerIds: string[]
}

/**
 * Identifies a tool call emitted by a model iteration. Matches the
 * `tool_call.id` convention used by OpenAI, Anthropic, and the OTel GenAI
 * spec so tool segments can be correlated back to the iteration that issued
 * them.
 */
export interface IterationToolCall {
  id: string
  name: string
  arguments: Record<string, unknown> | string
}

/**
 * A single phase of provider execution (model call or tool invocation).
 *
 * Providers emit these per iteration. Model segments carry the assistant's
 * output for that iteration (text, thinking, tool_calls, tokens, finish
 * reason) so the trace reveals *why* each tool was invoked — not just that
 * it was. All content fields are optional; providers fill in what they have.
 */
export interface ProviderTimingSegment {
  type: 'model' | 'tool'
  name?: string
  startTime: number
  endTime: number
  duration: number
  assistantContent?: string
  thinkingContent?: string
  toolCalls?: IterationToolCall[]
  toolCallId?: string
  finishReason?: string
  tokens?: BlockTokens
  /** Cost for this segment in USD, derived from tokens + model pricing. */
  cost?: { input?: number; output?: number; total?: number }
  /** Time-to-first-token in ms (streaming only; first segment typically). */
  ttft?: number
  /** Provider system identifier (anthropic, openai, gemini, etc.) — `gen_ai.system`. */
  provider?: string
  /** Structured error class (e.g. `rate_limit`, `context_length`). */
  errorType?: string
  /** Human-readable error message when this segment failed. */
  errorMessage?: string
}

/** Timing info reported by an LLM provider for a single block execution. */
interface BlockProviderTiming {
  startTime: string
  endTime: string
  duration: number
  modelTime?: number
  toolsTime?: number
  firstResponseTime?: number
  iterations?: number
  timeSegments?: ProviderTimingSegment[]
}

/** Cost breakdown from provider usage. */
interface BlockCost {
  input: number
  output: number
  total: number
  toolCost?: number
  pricing?: {
    input: number
    output: number
    cachedInput?: number
    updatedAt: string
  }
}

/** Token usage from provider. `prompt`/`completion` are legacy aliases. */
export interface BlockTokens {
  input?: number
  output?: number
  total?: number
  prompt?: number
  completion?: number
  /** Input tokens served from the provider's prompt cache. */
  cacheRead?: number
  /** Input tokens newly written to the provider's prompt cache. */
  cacheWrite?: number
  /** Output tokens consumed by reasoning/thinking (o-series, Claude, Gemini). */
  reasoning?: number
}

/** A single tool invocation recorded by an agent-type block. */
export interface BlockToolCall {
  name: string
  duration?: number
  startTime?: string
  endTime?: string
  error?: string
  arguments?: Record<string, unknown>
  input?: Record<string, unknown>
  result?: unknown
  output?: Record<string, unknown>
}

/** Normalized tool-call container emitted by providers. */
interface BlockToolCalls {
  list: BlockToolCall[]
  count: number
}

export interface NormalizedBlockOutput {
  [key: string]: any
  content?: string
  model?: string
  tokens?: BlockTokens
  toolCalls?: BlockToolCalls
  providerTiming?: BlockProviderTiming
  cost?: BlockCost
  files?: UserFile[]
  selectedPath?: {
    blockId: string
    blockType?: string
    blockTitle?: string
  }
  selectedOption?: string
  conditionResult?: boolean
  result?: any
  stdout?: string
  executionTime?: number
  data?: any
  status?: number
  headers?: Record<string, string>
  error?: string
  childTraceSpans?: TraceSpan[]
  childWorkflowName?: string
  _pauseMetadata?: PauseMetadata
}

export const EXECUTION_CONTROL_OUTPUT_FIELD_NAMES = [
  'error',
  'selectedOption',
  'selectedRoute',
  '_pauseMetadata',
] as const

export type ExecutionControlOutputFieldName = (typeof EXECUTION_CONTROL_OUTPUT_FIELD_NAMES)[number]

/** Start block output key that carries trusted, server-injected run metadata. */
export const START_BLOCK_METADATA_FIELD = 'metadata'

/**
 * Trusted run metadata surfaced under `<start.metadata.*>` when the Start
 * block's "Add run metadata" toggle is enabled. Built server-side from the
 * authenticated execution context — never from caller-supplied input.
 * Every field describes the INVOKING run: on top-level runs that is the run
 * itself; on child and custom-block executions it is the parent run (its
 * actor's email, workspace, and workflow) — never the child's own static,
 * authoring-time-known identity.
 */
export interface StartBlockRunMetadata {
  userEmail?: string | null
  workspaceId?: string | null
  workflowId?: string | null
  executionId?: string
  executionType?: string
  executionMode?: 'sync' | 'stream' | 'async'
  startTime?: string
}

export interface BlockLog {
  blockId: string
  blockName?: string
  blockType?: string
  startedAt: string
  endedAt: string
  durationMs: number
  success: boolean
  output?: NormalizedBlockOutput
  input?: Record<string, unknown>
  error?: string
  /** Whether this error was handled by an error handler path (error port) */
  errorHandled?: boolean
  /** Total handler tries, present only when the block retried at least once. */
  tries?: number
  loopId?: string
  parallelId?: string
  iterationIndex?: number
  /** Full ancestor iteration chain for nested subflows (outermost → innermost). */
  parentIterations?: ParentIteration[]
  /**
   * Monotonically increasing integer (1, 2, 3, ...) for accurate block ordering.
   * Generated via getNextExecutionOrder() to ensure deterministic sorting.
   */
  executionOrder: number
  /**
   * Child workflow trace spans for nested workflow execution.
   * Stored separately from output to keep output clean for display
   * while preserving data for trace-spans processing.
   */
  childTraceSpans?: TraceSpan[]
  /**
   * A custom block's child run, which executes under its own execution id against
   * the SOURCE workspace. Only the opaque id crosses the invocation boundary — the
   * child's spans stay on its own log row and are joined at READ time. Written only
   * for a block whose publisher opted its runs into consumer traces — the presence of
   * this id IS that permission. Kept off `output` for the same reason
   * {@link childTraceSpans} is.
   */
  childExecution?: { executionId: string }
  /**
   * A custom block ran a child whose publisher has not opened it to consumers, so no
   * `childExecution` handle exists to join. Recorded because a boundary span with
   * no children is otherwise indistinguishable from a leaf block.
   */
  childTraceDisabled?: boolean
  /** Internal encrypted sidecar used only for causal display projection. */
  displayResolvedSecretTraceProvenance?: ResolvedSecretTraceProvenanceV1
}

interface ExecutionMetadata {
  requestId?: string
  workflowId?: string
  workspaceId?: string
  /** Immutable actor/payer decision captured before execution. */
  billingAttribution?: BillingAttributionSnapshot
  startTime?: string
  endTime?: string
  duration: number
  pendingBlocks?: string[]
  isDebugSession?: boolean
  context?: ExecutionContext
  workflowConnections?: Array<{ source: string; target: string }>
  credentialAccountUserId?: string
  largeValueKeys?: string[]
  fileKeys?: string[]
  status?: 'running' | 'paused' | 'completed'
  pausePoints?: string[]
  resumeChain?: {
    parentExecutionId?: string
    depth: number
  }
  userId?: string
  principal?: WorkflowExecutionPrincipal
  executionId?: string
  triggerType?: string
  triggerBlockId?: string
  useDraftState?: boolean
  resumeFromSnapshot?: boolean
  resumeTerminalNoop?: boolean
  executionMode?: 'sync' | 'stream' | 'async'
  /**
   * Run-level agent-events opt-in (see the snapshot ExecutionMetadata).
   * Gates streaming tool loops and provider thinking-summary requests.
   */
  agentEvents?: boolean
}

export interface BlockState {
  output: NormalizedBlockOutput
  executed: boolean
  executionTime: number
  /** Encrypted candidates active in this block call. Consumers filter them to the selected value. */
  resolvedSecretTraceProvenance?: ResolvedSecretTraceProvenanceV1
}

/**
 * Canonical signed execution identity used for executor-delegated internal operations.
 *
 * A nested workflow changes {@link ExecutionContext.workflowId} for execution semantics, but it
 * still belongs to the parent log row identified here. Custom blocks replace this origin with the
 * publisher-owned child execution after opening their own source-workspace log row.
 */
export interface ExecutorDelegationOrigin {
  subjectUserId?: string
  workflowId: string
  executionId?: string
  principal?: WorkflowExecutionPrincipal
  currentWorkflow?: WorkflowExecutionAuthority
}

export interface ExecutionContext {
  workflowId: string
  workspaceId?: string
  executionId?: string
  largeValueExecutionIds?: string[]
  largeValueKeys?: string[]
  fileKeys?: string[]
  allowLargeValueWorkflowScope?: boolean
  userId?: string
  /** Original authenticated caller for resource-policy decisions. */
  principal?: WorkflowExecutionPrincipal
  /** Trusted origin for signed executor delegation, distinct from the currently executing child. */
  executorDelegationOrigin?: ExecutorDelegationOrigin
  isDeployedContext?: boolean
  enforceCredentialAccess?: boolean
  copilotToolExecution?: boolean
  /** In-flight block-output PII redaction policy (resolved `blockOutputs` stage). */
  piiBlockOutputRedaction?: PiiBlockOutputRedaction

  permissionConfig?: PermissionGroupConfig | null
  permissionConfigLoaded?: boolean

  /**
   * Resolved display names for the resources an agent tool is bound to, keyed `${kind}:${id}`,
   * with `null` recording a miss so it is not retried. Shared across the whole run: an agent block
   * inside a loop re-formats its tools every iteration, and its bound resources do not change.
   *
   * A Map rather than plain fields on purpose — `blockCtx` is a shallow clone of this context per
   * block execution, so only a shared reference survives; a scalar written here would be lost.
   */
  toolBindingLabelCache?: Map<string, string | null>

  /**
   * Files produced during this execution, indexed by {@link UserFile.id}, so a
   * model can name one by id in a tool argument and the runtime can hydrate it
   * into the full object.
   *
   * Needed because a file an agent has just seen — a Gmail attachment fetched
   * moments ago in the same turn — lives only in that turn's tool results, not
   * in any block state or workspace row, so nothing else can resolve it. The
   * index only *selects*; every read is still authorized on its own.
   *
   * A Map for the same reason as {@link toolBindingLabelCache}: `blockCtx` is a
   * shallow clone per block execution, so only a shared reference survives.
   */
  executionFilesById?: Map<string, UserFile>

  blockStates: ReadonlyMap<string, BlockState>
  executedBlocks: ReadonlySet<string>

  blockLogs: BlockLog[]
  metadata: ExecutionMetadata
  /** Trusted run metadata for the Start block's "Add run metadata" toggle. */
  startRunMetadata?: StartBlockRunMetadata
  environmentVariables: Record<string, string>
  resolvedSecretTraceRegistry?: ResolvedSecretTraceRegistry
  /** Exact candidates that may be carried by this block's terminal error, never its normal output. */
  errorResolvedSecretTraceRegistry?: ResolvedSecretTraceRegistry
  workflowVariables?: Record<string, any>
  workflowVariableResolvedSecretTraceProvenance?: Record<string, ResolvedSecretTraceProvenanceV1>
  workflowInputResolvedSecretTraceProvenance?: ResolvedSecretTraceProvenanceV1
  finalOutputResolvedSecretTraceProvenance?: ResolvedSecretTraceProvenanceV1

  decisions: {
    router: Map<string, string>
    condition: Map<string, string>
  }

  completedLoops: Set<string>

  /**
   * Unified parent map for subflow nesting (loop-in-loop, parallel-in-parallel,
   * loop-in-parallel, parallel-in-loop). Maps any child subflow ID to its parent
   * subflow ID and type, enabling the iteration context builder to walk the full
   * ancestor chain regardless of subflow type.
   */
  subflowParentMap?: Map<
    string,
    { parentId: string; parentType: SubflowType; branchIndex?: number }
  >

  loopExecutions?: Map<
    string,
    {
      iteration: number
      currentIterationOutputs: Map<string, any>
      allIterationOutputs: any[][]
      maxIterations?: number
      item?: any
      items?: any[]
      condition?: string
      skipFirstConditionCheck?: boolean
      skippedAtStart?: boolean
      loopType?: 'for' | 'forEach' | 'while' | 'doWhile'
      inputResolvedSecretTraceProvenance?: ResolvedSecretTraceProvenanceV1
      resolvedSecretTraceProvenance?: ResolvedSecretTraceProvenanceV1
    }
  >

  parallelExecutions?: Map<
    string,
    {
      parallelId: string
      totalBranches: number
      batchSize?: number
      currentBatchStart?: number
      currentBatchSize?: number
      accumulatedOutputs?: Map<number, any[]>
      branchOutputs: Map<number, any[]>
      parallelType?: 'count' | 'collection'
      items?: any[]
      validationError?: string
      isEmpty?: boolean
      inputResolvedSecretTraceProvenance?: ResolvedSecretTraceProvenanceV1
      resolvedSecretTraceProvenance?: ResolvedSecretTraceProvenanceV1
    }
  >

  parallelBlockMapping?: Map<
    string,
    {
      originalBlockId: string
      parallelId: string
      iterationIndex: number
    }
  >

  currentVirtualBlockId?: string

  activeExecutionPath: Set<string>

  workflow?: SerializedWorkflow

  stream?: boolean
  selectedOutputs?: string[]
  edges?: Array<{ source: string; target: string }>

  onStream?: (streamingExecution: StreamingExecution) => Promise<void>
  onBlockStart?: (
    blockId: string,
    blockName: string,
    blockType: string,
    executionOrder: number,
    iterationContext?: IterationContext,
    childWorkflowContext?: ChildWorkflowContext
  ) => Promise<void>
  onBlockComplete?: (
    blockId: string,
    blockName: string,
    blockType: string,
    output: any,
    iterationContext?: IterationContext,
    childWorkflowContext?: ChildWorkflowContext
  ) => Promise<void>

  /** Context identifying this execution as a child of a workflow block */
  childWorkflowContext?: ChildWorkflowContext

  /** Fires immediately after instanceId is generated, before child execution begins. */
  onChildWorkflowInstanceReady?: (
    blockId: string,
    childWorkflowInstanceId: string,
    iterationContext?: IterationContext,
    executionOrder?: number,
    childWorkflowContext?: ChildWorkflowContext
  ) => Promise<void>

  /**
   * AbortSignal for cancellation support.
   * When the signal is aborted, execution should stop gracefully.
   * This is triggered when the SSE client disconnects.
   */
  abortSignal?: AbortSignal

  /**
   * When true, UserFile objects in block outputs will be hydrated with base64 content
   * before being stored in execution state. This ensures base64 is available for
   * variable resolution in downstream blocks.
   */
  includeFileBase64?: boolean

  /**
   * Maximum file size in bytes for base64 hydration. Files larger than this limit
   * will not have their base64 content fetched.
   */
  base64MaxBytes?: number

  /**
   * Context for "run from block" mode. When present, only blocks in dirtySet
   * will be executed; others return cached outputs from the source snapshot.
   */
  runFromBlockContext?: RunFromBlockContext

  /**
   * Stop execution after this block completes. Used for "run until block" feature.
   */
  stopAfterBlockId?: string

  /**
   * Ordered list of workflow IDs in the current call chain, used for cycle detection.
   * Passed to outgoing HTTP requests via the X-Sim-Via header.
   */
  callChain?: string[]

  /**
   * The Sim user watching this run's live block stream, when there is exactly one
   * and they are a known, authenticated workspace member — i.e. an editor/manual
   * run. Deliberately UNSET on chat deployments, public API, webhook, and schedule
   * runs, whose stream consumer may be an anonymous external visitor.
   *
   * Whether a custom block may stream the SOURCE workflow's block events is the
   * publisher's decision, not this viewer's — but that decision covers the ORG, so it
   * still requires a stream with an identified consumer. This field is the proof of
   * one; absent, the boundary holds and every anonymous-consumer surface is
   * fail-closed by default.
   */
  liveTraceViewerUserId?: string

  /**
   * Block callbacks that ONLY emit to the live stream — they never write the invoking
   * run's progress markers. `onBlockStart`/`onBlockComplete` above are persist-then-emit
   * composites: on the invoking run they write block names and I/O into that run's
   * `LoggingSession` before reaching the stream.
   *
   * A custom block's child must reach the emit half and never the persist half. The
   * stream is gated on the publisher's trace policy AND an identified consumer, but a
   * persisted marker is keyed by the PARENT execution and is readable by anyone with
   * parent-workspace access on any surface — so persisting the source workflow's block
   * names there would leak them past the gate entirely.
   */
  liveStreamCallbacks?: Pick<ExecutionCallbacks, 'onBlockStart' | 'onBlockComplete'>

  /**
   * Counter for generating monotonically increasing execution order values.
   * Starts at 0 and increments for each block. Use getNextExecutionOrder() to access.
   */
  executionOrderCounter?: { value: number }
}

/**
 * Gets the next execution order value for a block.
 * Returns a simple incrementing integer (1, 2, 3, ...) for clear ordering.
 */
export function getNextExecutionOrder(ctx: ExecutionContext): number {
  if (!ctx.executionOrderCounter) {
    ctx.executionOrderCounter = { value: 0 }
  }
  return ++ctx.executionOrderCounter.value
}

export interface ExecutionResult {
  success: boolean
  output: NormalizedBlockOutput
  error?: string
  logs?: BlockLog[]
  executionState?: SerializableExecutionState
  metadata?: ExecutionMetadata
  status?: 'completed' | 'paused' | 'cancelled'
  pausePoints?: PausePoint[]
  snapshotSeed?: SerializedSnapshot
  _streamingMetadata?: {
    loggingSession: any
    processedInput: any
  }
}

export interface StreamingExecution {
  /** Workflow block invocation that owns this stream. */
  blockId?: string
  /** Per-run invocation order, unique across loop and parallel executions. */
  executionOrder?: number
  /**
   * Provider stream payload. Format is declared by {@link streamFormat}:
   * - `'text'` (default): UTF-8 answer bytes (`ReadableStream<Uint8Array>`)
   * - `'agent-events-v1'`: in-process `ReadableStream` of `AgentStreamEvent` objects
   *
   * Never sniff the payload; always read {@link streamFormat}.
   * After the executor pump, {@link stream} is always projected UTF-8 answer text.
   */
  stream: ReadableStream
  /**
   * Discriminator for {@link stream}. Defaults to `'text'` when omitted so
   * existing providers remain byte-stream consumers without changes.
   */
  streamFormat?: 'text' | 'agent-events-v1'
  /**
   * Optional sink subscription installed synchronously during `onStream` before
   * the executor pump starts draining. Late subscribers receive future events only.
   */
  subscribe?: (sink: AgentStreamSink) => UnsubscribeAgentStreamSink
  /**
   * True when {@link stream} is a response-format projection (selected JSON
   * fields extracted from structured output) rather than raw answer text. Sink
   * `text_delta` events then do NOT match the byte stream, so consumers must
   * keep sourcing answer text from {@link stream} instead of the sink.
   */
  clientStreamTransformed?: boolean
  /** Internal provenance for the exact block input that initiated this live stream. */
  displayResolvedSecretTraceProvenance?: ResolvedSecretTraceProvenanceV1
  /** Internal source registry retained only for sanitizing failures while the stream drains. */
  diagnosticResolvedSecretTraceRegistry?: ResolvedSecretTraceRegistry
  execution: ExecutionResult & { isStreaming?: boolean }
  /**
   * Invoked with the assembled response text after the stream drains. Lets agent
   * blocks persist the full response without interposing a TransformStream on a
   * fetch-backed source — that pattern amplifies memory on Bun via #28035.
   */
  onFullContent?: (content: string) => void | Promise<void>
}

interface BlockExecutor {
  canExecute(block: SerializedBlock): boolean

  execute(
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<BlockOutput>
}

/**
 * Per-invocation identity for one run of one block.
 *
 * `executionOrder` is the field a `keyed` delivery derives its idempotency token
 * from. It is assigned once, before the block executor's retry wrapper, and is
 * distinct per loop iteration and per parallel branch — so it is both stable
 * across every retry layer and distinguishing between logically separate
 * invocations. Both halves are required; see `KeyedDeliveryContext`.
 */
export interface BlockNodeMetadata {
  nodeId: string
  loopId?: string
  parallelId?: string
  branchIndex?: number
  branchTotal?: number
  originalBlockId?: string
  isLoopNode?: boolean
  executionOrder?: number
}

export interface BlockHandler {
  canHandle(block: SerializedBlock): boolean

  /**
   * `nodeMetadata` is optional so the many handlers that do not need an
   * invocation identity keep their three-parameter signature.
   */
  execute(
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>,
    nodeMetadata?: BlockNodeMetadata
  ): Promise<BlockOutput | StreamingExecution>

  executeWithNode?: (
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>,
    nodeMetadata: BlockNodeMetadata
  ) => Promise<BlockOutput | StreamingExecution>
}

interface Tool<P = any, O = Record<string, any>> {
  id: string
  name: string
  description: string
  version: string

  params: {
    [key: string]: {
      type: string
      required?: boolean
      description?: string
      default?: any
    }
  }

  request?: {
    url?: string | ((params: P) => string)
    method?: string
    headers?: (params: P) => Record<string, string>
    body?: (params: P) => Record<string, any>
  }

  transformResponse?: (response: any) => Promise<{
    success: boolean
    output: O
    error?: string
  }>
}

interface ToolRegistry {
  [key: string]: Tool
}

export interface ResponseFormatStreamProcessor {
  processStream(
    originalStream: ReadableStream,
    blockId: string,
    selectedOutputs: string[],
    responseFormat?: any
  ): ReadableStream
}
