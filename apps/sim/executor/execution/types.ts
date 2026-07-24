import type { Edge } from 'reactflow'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import type { AsyncExecutionCorrelation } from '@/lib/core/async-jobs/types'
import type { CustomPiiPattern } from '@/lib/guardrails/pii-entities'
import type { NodeMetadata } from '@/executor/dag/types'
import type {
  BlockLog,
  BlockState,
  NormalizedBlockOutput,
  StartBlockRunMetadata,
  StreamingExecution,
} from '@/executor/types'
import type { RunFromBlockContext } from '@/executor/utils/run-from-block'
import type { SubflowType } from '@/stores/workflows/workflow/types'

export interface ExecutionMetadata {
  requestId: string
  executionId: string
  workflowId: string
  workspaceId: string
  userId: string
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
  pendingBlocks?: string[]
  resumeFromSnapshot?: boolean
  resumeTerminalNoop?: boolean
  credentialAccountUserId?: string
  workflowStateOverride?: {
    blocks: Record<string, any>
    edges: Edge[]
    loops?: Record<string, any>
    parallels?: Record<string, any>
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
    output: any,
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
    output: {
      input?: any
      output: NormalizedBlockOutput
      executionTime: number
      startedAt: string
      executionOrder: number
      endedAt: string
      /** Per-invocation unique ID linking this workflow block execution to its child block events. */
      childWorkflowInstanceId?: string
    },
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
}

export interface WorkflowInput {
  [key: string]: unknown
}

interface BlockStateReader {
  getBlockOutput(blockId: string, currentNodeId?: string): NormalizedBlockOutput | undefined
  hasExecuted(blockId: string): boolean
}

export interface BlockStateWriter {
  setBlockOutput(blockId: string, output: NormalizedBlockOutput, executionTime?: number): void
  setBlockState(blockId: string, state: BlockState): void
  deleteBlockState(blockId: string): void
  unmarkExecuted(blockId: string): void
}

export type BlockStateController = BlockStateReader & BlockStateWriter
