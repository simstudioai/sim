import type { Edge } from '@xyflow/react'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import type { AsyncExecutionCorrelation } from '@/lib/core/async-jobs/types'
import type { ParentIteration, SerializableExecutionState } from '@/executor/execution/types'
import type {
  BlockTokens,
  IterationToolCall,
  NormalizedBlockOutput,
  ProviderTimingSegment,
} from '@/executor/types'
import type { ResolvedSecretTraceProvenanceV1 } from '@/executor/utils/resolved-secret-trace-registry'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

export type { WorkflowState }
export type WorkflowEdge = Edge

export interface PricingInfo {
  input: number
  output: number
  cachedInput?: number
  updatedAt: string
}

export interface TokenUsage {
  input: number
  output: number
  total: number
}

export interface CostBreakdown {
  input: number
  output: number
  total: number
  tokens: TokenUsage
  model: string
  pricing: PricingInfo
}

export interface ToolCall {
  name: string
  duration: number
  startTime: string
  endTime: string
  status: 'success' | 'error'
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  error?: string
}

export type BlockInputData = Record<string, any>
export type BlockOutputData = NormalizedBlockOutput | null

export interface ExecutionEnvironment {
  variables: Record<string, string>
  workflowId: string
  executionId: string
  userId: string
  workspaceId: string
}

import type { CoreTriggerType } from '@/stores/logs/filters/types'

export interface ExecutionTrigger {
  type: CoreTriggerType | string
  source: string
  data?: Record<string, unknown> & {
    correlation?: AsyncExecutionCorrelation
  }
  timestamp: string
}

export interface ExecutionStatus {
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  startedAt: string
  endedAt?: string
  durationMs?: number
}

export const EXECUTION_FINALIZATION_PATHS = [
  'completed',
  'fallback_completed',
  'force_failed',
  'cancelled',
  'paused',
] as const

export type ExecutionFinalizationPath = (typeof EXECUTION_FINALIZATION_PATHS)[number]

export interface ExecutionLastStartedBlock {
  blockId: string
  blockName: string
  blockType: string
  startedAt: string
}

export interface ExecutionLastCompletedBlock {
  blockId: string
  blockName: string
  blockType: string
  endedAt: string
  success: boolean
}

export interface WorkflowExecutionSnapshot {
  id: string
  workflowId: string | null
  stateHash: string
  stateData: WorkflowState
  createdAt: string
}

export type WorkflowExecutionSnapshotInsert = Omit<WorkflowExecutionSnapshot, 'createdAt'>
export type WorkflowExecutionSnapshotSelect = WorkflowExecutionSnapshot

export interface WorkflowExecutionLog {
  id: string
  workflowId: string | null
  executionId: string
  stateSnapshotId: string
  level: 'info' | 'error'
  trigger: ExecutionTrigger['type']
  startedAt: string
  endedAt: string
  totalDurationMs: number
  files?: Array<{
    id: string
    name: string
    size: number
    type: string
    url: string
    key: string
  }>
  // Execution details
  executionData: {
    secretProjectionVersion?: 1
    /**
     * Run-level provenance, stored alongside the contract marker rather than
     * only inside `executionState` so it survives both compaction and PII
     * redaction dropping the state. The display projection needs it to rebuild
     * its registry.
     */
    resolvedSecretTraceProvenance?: ResolvedSecretTraceProvenanceV1
    environment?: ExecutionEnvironment
    trigger?: ExecutionTrigger
    billingAttribution?: BillingAttributionSnapshot
    correlation?: AsyncExecutionCorrelation
    error?: string
    lastStartedBlock?: ExecutionLastStartedBlock
    lastCompletedBlock?: ExecutionLastCompletedBlock
    hasTraceSpans?: boolean
    traceSpanCount?: number
    completionFailure?: string
    finalizationPath?: ExecutionFinalizationPath
    traceSpans?: TraceSpan[]
    tokens?: { input?: number; output?: number; total?: number }
    models?: Record<
      string,
      {
        input?: number
        output?: number
        total?: number
        tokens?: { input?: number; output?: number; total?: number }
      }
    >
    executionState?: SerializableExecutionState
    executionStateSummary?: {
      executedBlockCount: number
      blockLogCount: number
      completedLoopCount: number
      activeExecutionPathLength: number
      pendingQueueLength: number
    }
    executionDataTruncated?: boolean
    executionDataOriginalBytes?: number
    executionDataStoredBytes?: number
    executionDataMaxBytes?: number
    executionDataTruncationReason?: string
    finalOutput?: any
    workflowInput?: unknown
    errorDetails?: {
      blockId: string
      blockName: string
      error: string
      stackTrace?: string
    }
  }
  // Top-level cost information
  cost?: {
    input?: number
    output?: number
    total?: number
    tokens?: { input?: number; output?: number; total?: number }
    models?: Record<
      string,
      {
        input?: number
        output?: number
        total?: number
        tokens?: { input?: number; output?: number; total?: number }
      }
    >
  }
  duration?: string
  createdAt: string
}

/**
 * Every value written into `workflow_execution_logs.status`. The column is free text and
 * one writer sets it through a raw `sql` CASE Drizzle cannot type-check, so this list —
 * not the column type — is the only source of truth. API contracts that pass the column
 * through derive their enums from it, so adding a status here widens the public wire; the
 * contract tests fail until that widening is reviewed and the OpenAPI specs regenerated.
 *
 * `redacting` is transient while a finished run's output is scrubbed. `paused` is written
 * only by `PauseResumeManager.markResumeAttemptFailed`, when a resume attempt does not run
 * to completion — it failed admission, the run buffer was unavailable, the resume job could
 * not be enqueued, or the attempt was cancelled. An ordinary human-in-the-loop pause
 * persists `pending`.
 */
export const PERSISTED_WORKFLOW_EXECUTION_STATUSES = [
  'pending',
  'running',
  'paused',
  'redacting',
  'completed',
  'failed',
  'cancelled',
] as const

export type PersistedWorkflowExecutionStatus =
  (typeof PERSISTED_WORKFLOW_EXECUTION_STATUSES)[number]

/** Narrows an already-validated status string onto the persisted vocabulary. */
export function isPersistedWorkflowExecutionStatus(
  value: string
): value is PersistedWorkflowExecutionStatus {
  return (PERSISTED_WORKFLOW_EXECUTION_STATUSES as readonly string[]).includes(value)
}
/**
 * In-flight statuses a crashed worker can strand, which the stale-execution
 * cron terminalizes. `pending` and `paused` are excluded: both are written as
 * the resting state of a run waiting on a resume, so sweeping them would fail
 * live work. Each status here needs its own partial index on
 * `workflow_execution_logs` — the sweep runs one status per pass so it can use
 * them.
 */
export const STALE_SWEEPABLE_EXECUTION_STATUSES = [
  'running',
  'redacting',
] as const satisfies readonly PersistedWorkflowExecutionStatus[]

export type StaleSweepableExecutionStatus = (typeof STALE_SWEEPABLE_EXECUTION_STATUSES)[number]

export interface CompletedWorkflowExecutionLog extends WorkflowExecutionLog {
  persistedStatus: PersistedWorkflowExecutionStatus
}

export type WorkflowExecutionLogInsert = Omit<WorkflowExecutionLog, 'id' | 'createdAt'>
export type WorkflowExecutionLogSelect = WorkflowExecutionLog

export type TokenInfo = BlockTokens

export interface ProviderTiming {
  duration: number
  startTime: string
  endTime: string
  segments: ProviderTimingSegment[]
}

export interface TraceSpan {
  id: string
  name: string
  type: string
  duration: number
  startTime: string
  endTime: string
  children?: TraceSpan[]
  /**
   * @deprecated Tool invocations are emitted as `children` with `type: 'tool'`.
   * This field only appears on legacy trace spans persisted before the unification.
   */
  toolCalls?: ToolCall[]
  status?: 'success' | 'error'
  /** Whether this block's error was handled by an error handler path */
  errorHandled?: boolean
  /** Total handler tries, present only when the block retried at least once. */
  tries?: number
  tokens?: TokenInfo
  relativeStartMs?: number
  blockId?: string
  executionOrder?: number
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  childWorkflowSnapshotId?: string
  childWorkflowId?: string
  /**
   * For a custom-block span: the child run's own execution id, in the SOURCE
   * workspace. Only this opaque handle is persisted — the child's spans are
   * joined at read time by `hydrateChildTraces`. Written only for a block whose
   * publisher opted its runs into consumer traces, so its presence IS the permission
   * and no check runs at read time.
   */
  childExecutionId?: string
  /**
   * A custom block ran a child whose publisher has not opened it to consumers, so
   * no {@link childExecutionId} was ever written and there is nothing to join.
   * Persisted, unlike {@link childTraceAccess}: it describes the run, not a read.
   * Without it an untraced boundary renders exactly like a leaf block.
   */
  childTraceDisabled?: boolean
  /**
   * Set by read-time hydration on a span carrying {@link childExecutionId}: whether
   * the child run was joined, whether the block's publisher currently allows it
   * (`disabled`), whether the run still exists, and — for `truncated` — whether
   * hydration simply never attempted it (past the nesting/row cap, or the lookup
   * failed). It carries no verdict about the READER; the only policy is the
   * publisher's. `truncated` must never be conflated with an empty child: a boundary
   * span with no children and no marker is indistinguishable from a leaf block, which
   * would render a partial trace as a complete one. Never persisted — it describes
   * one read, not the run.
   */
  childTraceAccess?: 'granted' | 'disabled' | 'missing' | 'truncated'
  model?: string
  cost?: {
    input?: number
    output?: number
    total?: number
    toolCost?: number
  }
  providerTiming?: ProviderTiming
  loopId?: string
  parallelId?: string
  iterationIndex?: number
  parentIterations?: ParentIteration[]
  /** Internal encrypted sidecar removed by trace projection before persistence or display. */
  displayResolvedSecretTraceProvenance?: ResolvedSecretTraceProvenanceV1
  /**
   * For model child spans: the assistant's thinking/reasoning blocks from this
   * iteration, stringified. Surfaces Anthropic extended thinking and equivalents.
   */
  thinking?: string
  /**
   * For model child spans: the tool calls the assistant requested in this
   * iteration. `id` is the provider-assigned `tool_call.id`, used to correlate
   * the following tool child span via its `toolCallId` field.
   */
  modelToolCalls?: IterationToolCall[]
  /**
   * For model child spans: the provider-reported stop reason
   * (`stop`, `tool_use`, `length`, …).
   */
  finishReason?: string
  /**
   * For tool child spans: the `tool_call.id` this tool invocation satisfies.
   * Matches one of the preceding model child's `modelToolCalls[i].id`.
   */
  toolCallId?: string
  /**
   * For model child spans: time-to-first-token in ms (streaming runs only).
   */
  ttft?: number
  /**
   * For model child spans: the provider system identifier
   * (`anthropic`, `openai`, `gemini`, …) — aligns with OTel `gen_ai.system`.
   */
  provider?: string
  /**
   * For failed child spans: structured error class
   * (e.g. `rate_limit`, `context_length`).
   */
  errorType?: string
  /** For failed child spans: human-readable error message. */
  errorMessage?: string
}

export interface WorkflowExecutionSummary {
  id: string
  workflowId: string
  workflowName: string
  executionId: string
  trigger: ExecutionTrigger['type']
  status: ExecutionStatus['status']
  startedAt: string
  endedAt: string
  durationMs: number

  costSummary: {
    total: number
    inputCost: number
    outputCost: number
    tokens: number
  }
  stateSnapshotId: string
  errorSummary?: {
    blockId: string
    blockName: string
    message: string
  }
}

export interface WorkflowExecutionDetail extends WorkflowExecutionSummary {
  environment: ExecutionEnvironment
  triggerData: ExecutionTrigger
  blockExecutions: BlockExecutionSummary[]
  traceSpans: TraceSpan[]
  workflowState: WorkflowState
}

export interface BlockExecutionSummary {
  id: string
  blockId: string
  blockName: string
  blockType: string
  startedAt: string
  endedAt: string
  durationMs: number
  status: 'success' | 'error' | 'skipped'
  errorMessage?: string
  cost?: CostBreakdown
  inputSummary: {
    parameterCount: number
    hasComplexData: boolean
  }
  outputSummary: {
    hasOutput: boolean
    outputType: string
    hasError: boolean
  }
}

export interface PaginatedResponse<T> {
  data: T[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
    hasNext: boolean
    hasPrevious: boolean
  }
}

export type WorkflowExecutionsResponse = PaginatedResponse<WorkflowExecutionSummary>
export type BlockExecutionsResponse = PaginatedResponse<BlockExecutionSummary>

export interface WorkflowExecutionFilters {
  workflowIds?: string[]
  folderIds?: string[]
  triggers?: ExecutionTrigger['type'][]
  status?: ExecutionStatus['status'][]
  startDate?: string
  endDate?: string
  search?: string
  minDuration?: number
  maxDuration?: number
  minCost?: number
  maxCost?: number
  hasErrors?: boolean
}

export interface PaginationParams {
  page: number
  pageSize: number
  sortBy?: 'startedAt' | 'durationMs' | 'totalCost' | 'blockCount'
  sortOrder?: 'asc' | 'desc'
}

export interface LogsQueryParams extends WorkflowExecutionFilters, PaginationParams {
  includeBlockSummary?: boolean
  includeWorkflowState?: boolean
}

export interface LogsError {
  code: 'EXECUTION_NOT_FOUND' | 'SNAPSHOT_NOT_FOUND' | 'INVALID_WORKFLOW_STATE' | 'STORAGE_ERROR'
  message: string
  details?: Record<string, unknown>
}

export interface ValidationError {
  field: string
  message: string
  value: unknown
}

export class LogsServiceError extends Error {
  public code: LogsError['code']
  public details?: Record<string, unknown>

  constructor(message: string, code: LogsError['code'], details?: Record<string, unknown>) {
    super(message)
    this.name = 'LogsServiceError'
    this.code = code
    this.details = details
  }
}

export interface DatabaseOperationResult<T> {
  success: boolean
  data?: T
  error?: LogsServiceError
}

export interface BatchInsertResult<T> {
  inserted: T[]
  failed: Array<{
    item: T
    error: string
  }>
  totalAttempted: number
  totalSucceeded: number
  totalFailed: number
}

export interface SnapshotService {
  createSnapshot(workflowId: string, state: WorkflowState): Promise<WorkflowExecutionSnapshot>
  getSnapshot(id: string): Promise<WorkflowExecutionSnapshot | null>
  computeStateHash(state: WorkflowState): string
  cleanupOrphanedSnapshots(olderThanDays: number): Promise<number>
}

export interface SnapshotCreationResult {
  snapshot: WorkflowExecutionSnapshot
  isNew: boolean
}

export interface ExecutionLoggerService {
  loadTraceSpansForProjection(params: {
    executionId: string
    workflowId: string
    workspaceId: string | null
    traceSpans: TraceSpan[]
    isResume?: boolean
  }): Promise<TraceSpan[]>

  prepareTraceSpansForProjection(params: {
    executionId: string
    workflowId: string
    workspaceId: string | null
    userId?: string | null
    traceSpans: TraceSpan[]
  }): Promise<TraceSpan[]>

  startWorkflowExecution(params: {
    workflowId: string
    workspaceId: string
    executionId: string
    trigger: ExecutionTrigger
    environment: ExecutionEnvironment
    actorUserId?: string | null
    billingAttribution?: BillingAttributionSnapshot
    workflowState: WorkflowState
  }): Promise<{
    workflowLog: WorkflowExecutionLog
    snapshot: WorkflowExecutionSnapshot
  }>

  completeWorkflowExecution(params: {
    executionId: string
    endedAt: string
    totalDurationMs: number

    costSummary: {
      totalCost: number
      totalInputCost: number
      totalOutputCost: number
      totalTokens: number
    }
    finalOutput: BlockOutputData
    traceSpans?: TraceSpan[]
    workflowInput?: any
    executionState?: SerializableExecutionState
    finalizationPath?: ExecutionFinalizationPath
    completionFailure?: string
    isResume?: boolean
    level?: 'info' | 'error'
    status?: 'completed' | 'failed' | 'cancelled' | 'pending'
    actorUserId?: string | null
    billingAttribution?: BillingAttributionSnapshot
  }): Promise<CompletedWorkflowExecutionLog>
}
