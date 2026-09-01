import type { WorkflowExecutionPrincipal } from '@sim/auth/principal'
import type { Edge } from '@xyflow/react'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import type { AsyncExecutionCorrelation } from '@/lib/core/async-jobs/types'
import type { CustomPiiPattern } from '@/lib/guardrails/pii-entities'
import type { NodeMetadata } from '@/executor/dag/types'
import type {
  BlockLog,
  BlockState,
  ExecutorDelegationOrigin,
  NormalizedBlockOutput,
  StartBlockRunMetadata,
  StreamingExecution,
} from '@/executor/types'
import type {
  ResolvedSecretTraceProvenanceV1,
  ResolvedSecretTraceRegistry,
} from '@/executor/utils/resolved-secret-trace-registry'
import type { RunFromBlockContext } from '@/executor/utils/run-from-block'
import type { SubflowType } from '@/stores/workflows/workflow/types'

export interface ExecutionMetadata {
  requestId: string
  executionId: string
  workflowId: string
  workspaceId: string
  userId: string
  /** Original authenticated caller. Billing and executor user IDs never replace it. */
  principal: WorkflowExecutionPrincipal
  /** Immutable actor/payer decision captured before execution. */
  billingAttribution?: BillingAttributionSnapshot
  sessionUserId?: string
  workflowUserId?: string
  triggerType: string
  triggerBlockId?: string
  useDraftState: boolean
  startTime: string
  isClientSession?: boolean
  enforceCredentialAccess?: boolean
  /**
   * The run entered through the anonymous public-API path, so nobody in the
   * workspace triggered it. Unlike a schedule, webhook, or workspace API key —
   * all configured by someone here, which is why those still fall back to the
   * workflow owner's personal variables — this endpoint is callable by anyone,
   * and resolving one human's personal namespace for an anonymous caller is not
   * something the owner opted into. Such runs use the workspace's own billing
   * principal for both environment slices instead.
   */
  isPublicApiAccess?: boolean
  pendingBlocks?: string[]
  resumeFromSnapshot?: boolean
  resumeTerminalNoop?: boolean
  credentialAccountUserId?: string
  workflowStateOverride?: {
    blocks: Record<string, any>
    edges: Edge[]
    loops?: Record<string, any>
    parallels?: Record<string, any>
    variables?: Record<string, unknown>
    deploymentVersionId?: string
  }
  largeValueExecutionIds?: string[]
  largeValueKeys?: string[]
  fileKeys?: string[]
  allowLargeValueWorkflowScope?: boolean
  callChain?: string[]
  correlation?: AsyncExecutionCorrelation
  executionMode?: 'sync' | 'stream' | 'async'
  /**
   * Deployed-chat thinking policy half of the SSE dual gate. Persisted so HITL
   * resume can re-enable thinking frames without hardcoding false.
   */
  includeThinking?: boolean
  /**
   * Deployed-chat tool lifecycle policy half of the SSE dual gate. Persisted so
   * HITL resume can re-enable tool frames without coupling them to thinking.
   * Explicit false distinguishes new snapshots from legacy snapshots that
   * inherit the thinking policy.
   */
  includeToolCalls?: boolean
  /**
   * Run-level agent-events opt-in. True only on surfaces that consume thinking
   * and tool lifecycle events (canvas Run, dual-gated public chat). Enables the
   * live streaming tool loops and provider thinking-summary requests; when
   * unset, providers behave exactly as they did before agent events existed.
   */
  agentEvents?: boolean
}

export interface SerializableExecutionState {
  blockStates: Record<string, BlockState>
  executedBlocks: string[]
  blockLogs: BlockLog[]
  decisions: {
    router: Record<string, string>
    condition: Record<string, string>
  }
  completedLoops: string[]
  loopExecutions?: Record<string, any>
  parallelExecutions?: Record<string, any>
  parallelBlockMapping?: Record<string, any>
  activeExecutionPath: string[]
  pendingQueue?: string[]
  remainingEdges?: Edge[]
  resumeTerminalNoop?: boolean
  dagIncomingEdges?: Record<string, string[]>
  deactivatedEdges?: string[]
  nodesWithActivatedEdge?: string[]
  completedPauseContexts?: string[]
  /** Server execution that produced this state; callers must still verify it against storage. */
  sourceExecutionId?: string
  /** Server-only closure authorizing offloaded values carried by trusted restored state. */
  trustedLargeValueAccess?: {
    executionIds: string[]
    largeValueKeys: string[]
    fileKeys: string[]
  }
  /** Encrypted-only provenance for Secrets-tab values resolved during this execution. */
  resolvedSecretTraceProvenance?: ResolvedSecretTraceProvenanceV1
  /** Exact-value provenance for mutable workflow variables, keyed by persisted variable id. */
  workflowVariableResolvedSecretTraceProvenance?: Record<string, ResolvedSecretTraceProvenanceV1>
  /** Exact-value provenance for the persisted workflow input. Absence means legacy/untracked. */
  workflowInputResolvedSecretTraceProvenance?: ResolvedSecretTraceProvenanceV1
  /** Encrypted candidates for the persisted terminal output. Absence means legacy/untracked. */
  finalOutputResolvedSecretTraceProvenance?: ResolvedSecretTraceProvenanceV1
  /** Presence distinguishes current checkpoints from legacy states that predate provenance. */
  resolvedSecretTraceCheckpointVersion?: 1
}

/**
 * Represents the iteration state of an ancestor subflow in a nested chain.
 * Used to propagate parent iteration context through SSE events for both
 * loop-in-loop and parallel-in-parallel nesting hierarchies.
 */
export interface ParentIteration {
  iterationCurrent: number
  iterationTotal?: number
  iterationType: SubflowType
  iterationContainerId: string
}

export interface IterationContext {
  iterationCurrent: number
  iterationTotal?: number
  iterationType: SubflowType
  /**
   * Block ID of the loop or parallel container owning this iteration.
   * Optional because generic `<loop.index>` references may resolve before
   * the container ID is known (e.g., via `context.loopScope` fallback).
   * Always present on {@link ParentIteration} entries since those are built
   * from fully resolved ancestor loops.
   */
  iterationContainerId?: string
  parentIterations?: ParentIteration[]
}

/**
 * Metadata passed to block handlers that execute within subflow contexts
 * (loops, parallels, child workflows). Extends the DAG node metadata with
 * runtime identifiers needed for execution tracking.
 */
export interface WorkflowNodeMetadata
  extends Pick<
    NodeMetadata,
    'subflowType' | 'subflowId' | 'branchIndex' | 'branchTotal' | 'originalBlockId' | 'isLoopNode'
  > {
  nodeId: string
  loopId?: string
  parallelId?: string
  executionOrder?: number
}

export interface ChildWorkflowContext {
  /** The workflow block's ID in the parent execution */
  parentBlockId: string
  /** Display name of the child workflow */
  workflowName: string
  /** Child workflow ID */
  workflowId: string
  /** Nesting depth (1 = first level child) */
  depth: number
}

export interface BlockCompletionCallbackData {
  input?: unknown
  output: NormalizedBlockOutput
  /**
   * Encrypted candidates active in this block call. Internal durable consumers
   * filter them against the exact value that crosses a storage boundary.
   */
  resolvedSecretTraceProvenance?: ResolvedSecretTraceProvenanceV1
  /** Internal encrypted candidates filtered against the display envelope during projection. */
  displayResolvedSecretTraceProvenance?: ResolvedSecretTraceProvenanceV1
  executionTime: number
  startedAt: string
  executionOrder: number
  endedAt: string
  /** Per-invocation unique ID linking this workflow block execution to its child block events. */
  childWorkflowInstanceId?: string
  /** Root or child-workflow-scoped block identity used to match externally selected outputs. */
  outputBlockId?: string
}

export interface ExecutionCallbacks {
  onStream?: (streamingExec: StreamingExecution) => Promise<void>
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
    output: BlockCompletionCallbackData,
    iterationContext?: IterationContext,
    childWorkflowContext?: ChildWorkflowContext
  ) => Promise<void>
  /** Fires immediately after instanceId is generated, before child execution begins. */
  onChildWorkflowInstanceReady?: (
    blockId: string,
    childWorkflowInstanceId: string,
    iterationContext?: IterationContext,
    executionOrder?: number,
    childWorkflowContext?: ChildWorkflowContext
  ) => Promise<void>
}

/** In-flight block-output redaction policy (the resolved `blockOutputs` stage). */
export interface PiiBlockOutputRedaction {
  enabled: boolean
  /** Presidio entity types to mask. Empty = redact all detected PII. */
  entityTypes: string[]
  /** Language whose Presidio recognizers apply. */
  language: string
  /** User-supplied custom regex patterns applied alongside `entityTypes`. */
  customPatterns?: CustomPiiPattern[]
}

export interface ContextExtensions {
  workspaceId?: string
  executionId?: string
  largeValueExecutionIds?: string[]
  largeValueKeys?: string[]
  fileKeys?: string[]
  allowLargeValueWorkflowScope?: boolean
  userId?: string
  principal?: WorkflowExecutionPrincipal
  /** Canonical signed execution identity inherited by regular nested workflows. */
  executorDelegationOrigin?: ExecutorDelegationOrigin
  /**
   * Immutable actor/payer decision for this execution. Child workflow
   * executions receive it here (they carry no full metadata), so internal
   * tool calls inside the child still attach the billing attribution header.
   * Takes precedence over `metadata.billingAttribution` when both are set.
   */
  billingAttribution?: BillingAttributionSnapshot
  stream?: boolean
  selectedOutputs?: string[]
  edges?: Array<{ source: string; target: string }>
  isDeployedContext?: boolean
  enforceCredentialAccess?: boolean
  isChildExecution?: boolean
  resumeFromSnapshot?: boolean
  resumePendingQueue?: string[]
  remainingEdges?: Array<{
    source: string
    target: string
    sourceHandle?: string
    targetHandle?: string
  }>
  dagIncomingEdges?: Record<string, string[]>
  snapshotState?: SerializableExecutionState
  resolvedSecretTraceRegistry?: ResolvedSecretTraceRegistry
  workflowInputResolvedSecretTraceProvenance?: ResolvedSecretTraceProvenanceV1
  metadata?: ExecutionMetadata
  /**
   * Trusted run metadata injected into the Start block output when its
   * "Add run metadata" toggle is enabled. Built server-side at the two
   * Executor construction sites — never from caller-supplied input.
   */
  startRunMetadata?: StartBlockRunMetadata
  /**
   * AbortSignal for cancellation support.
   * When aborted, the execution should stop gracefully.
   */
  abortSignal?: AbortSignal
  includeFileBase64?: boolean
  base64MaxBytes?: number
  /**
   * When enabled, every block output is masked in-flight before downstream blocks
   * consume it. Resolved from the org/workspace PII redaction policy's
   * `blockOutputs` stage. Serializable, so it crosses into the trigger.dev worker.
   */
  piiBlockOutputRedaction?: PiiBlockOutputRedaction
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
    output: BlockCompletionCallbackData,
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
   * Run-from-block configuration. When provided, executor runs in partial
   * execution mode starting from the specified block.
   */
  runFromBlockContext?: RunFromBlockContext

  /**
   * Stop execution after this block completes. Used for "run until block" feature.
   */
  stopAfterBlockId?: string

  /**
   * Ordered list of workflow IDs in the current call chain, used for cycle detection.
   * Each hop appends the current workflow ID before making outgoing requests.
   */
  callChain?: string[]

  /**
   * The Sim user watching this run's live block stream, when there is exactly one
   * and they are a known, authenticated workspace member — i.e. an editor/manual
   * run. Deliberately UNSET on chat deployments, public API, webhook, and schedule
   * runs, whose stream consumer may be an anonymous external visitor.
   *
   * Used to decide whether a custom block may stream the SOURCE workflow's block
   * events across the invocation boundary: only if this viewer has access to the
   * source workspace. Absent means the boundary holds, so every surface that does
   * not opt in is fail-closed by default.
   */
  liveTraceViewerUserId?: string

  /**
   * Block callbacks that ONLY emit to the live stream — they never write the invoking
   * run's progress markers. `onBlockStart`/`onBlockComplete` above are persist-then-emit
   * composites: on the invoking run they write block names and I/O into that run's
   * `LoggingSession` before reaching the stream.
   *
   * A custom block's child must reach the emit half and never the persist half. The
   * stream is gated per viewer against the source workspace, but a persisted marker is
   * keyed by the PARENT execution and is readable by anyone with parent-workspace access
   * long after that check — so persisting the source workflow's block names there would
   * leak them past the boundary the gate exists to hold.
   */
  liveStreamCallbacks?: Pick<ExecutionCallbacks, 'onBlockStart' | 'onBlockComplete'>
}

export interface WorkflowInput {
  [key: string]: unknown
}

interface BlockStateReader {
  getBlockState(blockId: string, currentNodeId?: string): BlockState | undefined
  getBlockOutput(blockId: string, currentNodeId?: string): NormalizedBlockOutput | undefined
  hasExecuted(blockId: string): boolean
}

export interface BlockStateWriter {
  setBlockOutput(
    blockId: string,
    output: NormalizedBlockOutput,
    executionTime?: number,
    resolvedSecretTraceProvenance?: ResolvedSecretTraceProvenanceV1
  ): void
  setBlockState(blockId: string, state: BlockState): void
  deleteBlockState(blockId: string): void
  unmarkExecuted(blockId: string): void
}

export type BlockStateController = BlockStateReader & BlockStateWriter
