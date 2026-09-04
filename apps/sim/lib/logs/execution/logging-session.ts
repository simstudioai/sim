import { dbFor } from '@sim/db'
import { workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { describeError, toError } from '@sim/utils/errors'
import { and, eq, sql } from 'drizzle-orm'
import { releaseExecutionSlot } from '@/lib/billing/calculations/usage-reservation'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import { isRetryableInfrastructureError } from '@/lib/core/errors/retryable-infrastructure'
import { RESERVATION_TTL_BUFFER_MS } from '@/lib/core/execution-limits'
import type { LargeValueStoreContext } from '@/lib/execution/payloads/store'
import { terminalExecutionLogFields } from '@/lib/logs/execution/cancellation'
import type { SecretSafeBlockLog } from '@/lib/logs/execution/display-types'
import { executionLogger } from '@/lib/logs/execution/logger'
import {
  type CostSummaryOptions,
  calculateCostSummary,
  createEnvironmentObject,
  createTriggerObject,
  loadDeployedWorkflowStateForLogging,
  loadWorkflowStateForExecution,
} from '@/lib/logs/execution/logging-factory'
import {
  clearProgressMarkers,
  getProgressMarkers,
  setLastCompletedBlock,
  setLastStartedBlock,
} from '@/lib/logs/execution/progress-markers'
import {
  enforceTraceSpanSecretInvariant,
  projectTraceSpansForSecrets,
} from '@/lib/logs/execution/trace-secret-projection'
import { traceSpansIndicateFailure } from '@/lib/logs/execution/trace-spans/trace-spans'
import { SECRET_PROJECTION_VERSION } from '@/lib/logs/execution/trace-store'
import type {
  ExecutionEnvironment,
  ExecutionFinalizationPath,
  ExecutionLastCompletedBlock,
  ExecutionLastStartedBlock,
  ExecutionTrigger,
  PersistedWorkflowExecutionStatus,
  TraceSpan,
  WorkflowState,
} from '@/lib/logs/types'
import { notifyWorkflowRunTasks } from '@/lib/mothership/tasks/subscriptions'
import { recordSecretUsage } from '@/lib/secrets/usage/record'
import type { SerializableExecutionState } from '@/executor/execution/types'
import type { BlockLog } from '@/executor/types'
import { projectResolvedSecretDiagnosticError } from '@/executor/utils/resolved-secret-content-projection'
import {
  emptyResolvedSecretTraceProvenance,
  isResolvedSecretTraceProvenanceV1,
  RESOLVED_SECRET_TRACE_CHECKPOINT_VERSION,
  type ResolvedSecretTraceProvenanceV1,
  ResolvedSecretTraceRegistry,
} from '@/executor/utils/resolved-secret-trace-registry'

type TriggerData = Record<string, unknown> & {
  correlation?: NonNullable<ExecutionTrigger['data']>['correlation']
}

function buildStartedMarkerPersistenceQuery(params: {
  executionId: string
  workflowId: string
  marker: ExecutionLastStartedBlock
}) {
  const markerJson = JSON.stringify(params.marker)

  return sql`UPDATE workflow_execution_logs
    SET execution_data = jsonb_set(
      COALESCE(execution_data, '{}'::jsonb),
      '{lastStartedBlock}',
      ${markerJson}::jsonb,
      true
    )
    WHERE execution_id = ${params.executionId}
      AND workflow_id = ${params.workflowId}
      AND COALESCE(
        jsonb_extract_path_text(COALESCE(execution_data, '{}'::jsonb), 'lastStartedBlock', 'startedAt'),
        ''
      ) <= ${params.marker.startedAt}`
}

function buildCompletedMarkerPersistenceQuery(params: {
  executionId: string
  workflowId: string
  marker: ExecutionLastCompletedBlock
}) {
  const markerJson = JSON.stringify(params.marker)

  return sql`UPDATE workflow_execution_logs
    SET execution_data = jsonb_set(
      COALESCE(execution_data, '{}'::jsonb),
      '{lastCompletedBlock}',
      ${markerJson}::jsonb,
      true
    )
    WHERE execution_id = ${params.executionId}
      AND workflow_id = ${params.workflowId}
      AND COALESCE(
        jsonb_extract_path_text(COALESCE(execution_data, '{}'::jsonb), 'lastCompletedBlock', 'endedAt'),
        ''
      ) <= ${params.marker.endedAt}`
}

/** Progress-marker and status writes on `workflow_execution_logs` use the exec pool. */
const execDb = dbFor('exec')
function structuralBlockLog(log: BlockLog): BlockLog {
  const {
    input: _input,
    output: _output,
    error: _error,
    childTraceSpans: _childTraceSpans,
    displayResolvedSecretTraceProvenance: _displayResolvedSecretTraceProvenance,
    ...structural
  } = log
  return structural
}

function getActiveBlockDisplayProvenance(
  state?: SerializableExecutionState
): SerializableExecutionState['blockStates'][string]['resolvedSecretTraceProvenance'] {
  if (!state) return undefined
  const activeBlockId = state.activeExecutionPath.at(-1)
  return activeBlockId ? state.blockStates[activeBlockId]?.resolvedSecretTraceProvenance : undefined
}

const logger = createLogger('LoggingSession')

type CompletionAttempt = 'complete' | 'error' | 'cancelled' | 'paused'

export interface SecretSafeDisplayContent {
  input?: unknown
  output?: unknown
  error?: string
  text?: string
  chunk?: string
  clearLiveDisplay?: true
}

export interface SessionStartParams {
  userId?: string
  /** Explicit initiating actor for callers that do not populate `userId`. */
  actorUserId?: string | null
  /** Immutable actor/payer decision captured before execution. */
  billingAttribution?: BillingAttributionSnapshot
  workspaceId: string
  variables?: Record<string, string>
  triggerData?: TriggerData
  skipLogCreation?: boolean // For resume executions - reuse existing log entry
  deploymentVersionId?: string // ID of the deployment version used (null for manual/editor executions)
  workflowState?: WorkflowState
}

export interface SessionCompleteParams {
  endedAt?: string
  totalDurationMs?: number
  finalOutput?: any
  traceSpans?: TraceSpan[]
  workflowInput?: any
  executionState?: SerializableExecutionState
}

export interface SessionErrorCompleteParams {
  endedAt?: string
  totalDurationMs?: number
  error?: {
    message?: string
    stackTrace?: string
  }
  traceSpans?: TraceSpan[]
  skipCost?: boolean
  executionState?: SerializableExecutionState
}

export interface SessionCancelledParams {
  endedAt?: string
  totalDurationMs?: number
  traceSpans?: TraceSpan[]
  executionState?: SerializableExecutionState
}

export interface SessionPausedParams {
  endedAt?: string
  totalDurationMs?: number
  traceSpans?: TraceSpan[]
  workflowInput?: any
  executionState?: SerializableExecutionState
}

export interface LoggingSessionOptions {
  /**
   * Overrides the per-run fixed charge. Pass `0` for a run whose base charge is
   * already paid by its invoker, so it adds no second execution fee.
   */
  baseExecutionCharge?: number
}

export class LoggingSession {
  private workflowId: string
  private executionId: string
  private reservationId: string
  private triggerType: ExecutionTrigger['type']
  private requestId?: string
  private trigger?: ExecutionTrigger
  private environment?: ExecutionEnvironment
  private workflowState?: WorkflowState
  private correlation?: NonNullable<ExecutionTrigger['data']>['correlation']
  private trustedExecutionCorrelation?: NonNullable<ExecutionTrigger['data']>['correlation']
  private actorUserId: string | null = null
  /** Held directly rather than read off `environment`, which a caller may never build. */
  private workspaceId?: string
  private billingAttribution?: BillingAttributionSnapshot
  private isResume = false
  private completed = false
  /** Synchronous flag to prevent concurrent completion attempts (race condition guard) */
  private completing = false
  /** Tracks the in-flight completion promise so callers can await it */
  private completionPromise: Promise<void> | null = null
  private completionAttempt: CompletionAttempt | null = null
  private completionAttemptFailed = false
  private costOptions?: CostSummaryOptions
  private pendingProgressWrites = new Set<Promise<void>>()
  private postExecutionPromise: Promise<void> | null = null
  private resolvedSecretTraceRegistry?: ResolvedSecretTraceRegistry
  private traceLargeValueAccess: LargeValueStoreContext = {}
  private executionDeadlineAt?: Date
  private persistedCompletionStatus: PersistedWorkflowExecutionStatus | null = null
  private lastCompletionError: string | null = null

  constructor(
    workflowId: string,
    executionId: string,
    triggerType: ExecutionTrigger['type'],
    requestId?: string,
    reservationId = executionId,
    options?: LoggingSessionOptions
  ) {
    this.workflowId = workflowId
    this.executionId = executionId
    this.reservationId = reservationId
    this.triggerType = triggerType
    this.requestId = requestId
    this.costOptions =
      options?.baseExecutionCharge !== undefined
        ? { baseExecutionCharge: options.baseExecutionCharge }
        : undefined
  }

  /** Installs the run-scoped provenance used only at the terminal TraceSpan boundary. */
  setResolvedSecretTraceRegistry(registry: ResolvedSecretTraceRegistry): void {
    this.resolvedSecretTraceRegistry = registry
  }

  /** Exports exact active provenance for one settled value without changing that value. */
  exportResolvedSecretTraceProvenanceForValue(value: unknown): ResolvedSecretTraceProvenanceV1 {
    return (
      this.resolvedSecretTraceRegistry?.exportCommittedProvenanceForValue(value) ?? {
        version: 1,
        complete: false,
        entries: [],
      }
    )
  }

  /** Projects an execution error for operational logs and telemetry without mutating runtime data. */
  projectDiagnosticError(
    error: unknown,
    details: Record<string, unknown> = {}
  ): Record<string, unknown> {
    return projectResolvedSecretDiagnosticError(error, this.resolvedSecretTraceRegistry, details)
  }

  /** Adds server-validated lifecycle correlation without exposing it to executor metadata. */
  setTrustedExecutionCorrelation(
    correlation: NonNullable<NonNullable<ExecutionTrigger['data']>['correlation']>
  ): void {
    this.trustedExecutionCorrelation = { ...correlation }
  }

  /** Adds the trusted execution-ref scope needed to rewrite offloaded trace content. */
  setTraceLargeValueAccess(context: LargeValueStoreContext): void {
    this.traceLargeValueAccess = context
  }

  /** Sets the active attempt deadline before the executor creates or resumes its log row. */
  setExecutionDeadlineAt(deadline: Date | undefined): void {
    this.executionDeadlineAt = deadline ? new Date(deadline) : undefined
  }

  private getSecretProjectionStore(): LargeValueStoreContext {
    return {
      ...this.traceLargeValueAccess,
      workspaceId: this.environment?.workspaceId,
      workflowId: this.workflowId,
      executionId: this.executionId,
      userId: this.actorUserId ?? this.environment?.userId,
    }
  }

  private async projectRawTraceSpans(
    traceSpans: TraceSpan[],
    registry = this.resolvedSecretTraceRegistry
  ): Promise<TraceSpan[]> {
    return projectTraceSpansForSecrets(traceSpans, {
      registry,
      store: this.getSecretProjectionStore(),
    })
  }

  private async createDisplayProjectionRegistry(
    provenance?: unknown
  ): Promise<ResolvedSecretTraceRegistry | undefined> {
    if (provenance === undefined) return new ResolvedSecretTraceRegistry()

    if (!isResolvedSecretTraceProvenanceV1(provenance)) {
      const incomplete = new ResolvedSecretTraceRegistry()
      incomplete.markIncomplete('restored-provenance-untrusted')
      return incomplete
    }

    const registry = new ResolvedSecretTraceRegistry([], provenance.scope)
    await registry.importProvenance(provenance, {
      trusted: true,
      origin: 'loggingSession.restoredProvenance',
    })
    return registry
  }

  /**
   * Produces a display-only copy of known observability content through the same
   * projector used for persisted TraceSpans. Runtime values and callback payloads
   * remain untouched, and an unavailable projection yields no content fields.
   */
  async projectDisplayContent(
    content: SecretSafeDisplayContent,
    provenance?: unknown
  ): Promise<SecretSafeDisplayContent> {
    try {
      const registry = await this.createDisplayProjectionRegistry(provenance)
      const envelope: Record<string, unknown> = {}
      for (const key of ['input', 'output', 'error', 'text', 'chunk'] as const) {
        if (Object.hasOwn(content, key)) envelope[key] = content[key]
      }

      const now = new Date().toISOString()
      const [projectedSpan] = await this.projectRawTraceSpans(
        [
          {
            id: 'secret-safe-display-projection',
            name: 'Display Projection',
            type: 'display',
            duration: 0,
            startTime: now,
            endTime: now,
            output: envelope,
          },
        ],
        registry
      )
      const projected = this.readProjectedDisplayContent(projectedSpan?.output)
      return this.shouldClearLiveDisplay(registry)
        ? { ...projected, clearLiveDisplay: true }
        : projected
    } catch {
      logger.warn('Display secret projection failed; omitting display content')
      return {}
    }
  }

  private readProjectedDisplayContent(
    projectedEnvelope: TraceSpan['output'] | undefined
  ): SecretSafeDisplayContent {
    if (!projectedEnvelope) return {}

    const projected: SecretSafeDisplayContent = {}
    if (Object.hasOwn(projectedEnvelope, 'input')) projected.input = projectedEnvelope.input
    if (Object.hasOwn(projectedEnvelope, 'output')) projected.output = projectedEnvelope.output
    if (typeof projectedEnvelope.error === 'string') projected.error = projectedEnvelope.error
    if (typeof projectedEnvelope.text === 'string') projected.text = projectedEnvelope.text
    if (typeof projectedEnvelope.chunk === 'string') projected.chunk = projectedEnvelope.chunk
    return projected
  }

  /**
   * Projects terminal reconciliation logs without changing the executor-owned
   * BlockLogs. Child traces use the identical TraceSpan projection boundary.
   */
  async projectBlockLogsForDisplay(blockLogs: BlockLog[]): Promise<SecretSafeBlockLog[]> {
    const now = new Date().toISOString()
    const displayLogs: SecretSafeBlockLog[] = []

    for (let index = 0; index < blockLogs.length; index += 1) {
      const log = blockLogs[index]
      const provenance = log.displayResolvedSecretTraceProvenance
      if (!provenance) {
        displayLogs.push(structuralBlockLog(log))
        continue
      }

      try {
        const registry = await this.createDisplayProjectionRegistry(provenance)
        const [projectedLog] = await this.projectRawTraceSpans(
          [
            {
              id: `secret-safe-block-log-${index}`,
              name: 'Block Log Display Projection',
              type: 'display',
              duration: 0,
              startTime: now,
              endTime: now,
              output: {
                ...(log.input !== undefined ? { input: log.input } : {}),
                ...(log.output !== undefined ? { output: log.output } : {}),
                ...(log.error !== undefined ? { error: log.error } : {}),
              },
              ...(log.childTraceSpans ? { children: log.childTraceSpans } : {}),
            },
          ],
          registry
        )
        const display = this.readProjectedDisplayContent(projectedLog?.output)
        displayLogs.push({
          ...structuralBlockLog(log),
          ...(this.shouldClearLiveDisplay(registry) ? { clearLiveDisplay: true as const } : {}),
          ...(Object.hasOwn(display, 'input')
            ? { input: display.input as Record<string, unknown> }
            : {}),
          ...(Object.hasOwn(display, 'output')
            ? { output: display.output as BlockLog['output'] }
            : {}),
          ...(display.error !== undefined ? { error: display.error } : {}),
          ...(projectedLog?.children ? { childTraceSpans: projectedLog.children } : {}),
        })
      } catch {
        logger.warn('Block-log secret projection failed; retaining structural logs only')
        displayLogs.push(structuralBlockLog(log))
      }
    }

    return displayLogs
  }

  /**
   * Live deltas may split one literal across multiple events. Once provenance is
   * active (or incomplete), suppress their display copy instead of attempting a
   * per-chunk replacement that could miss the split value.
   */
  async projectLiveDisplayText(
    field: 'text' | 'chunk',
    value: string,
    provenance?: unknown
  ): Promise<SecretSafeDisplayContent> {
    const registry = await this.createDisplayProjectionRegistry(provenance)
    if (this.shouldClearLiveDisplay(registry)) {
      return { clearLiveDisplay: true }
    }
    return this.projectDisplayContent({ [field]: value }, provenance)
  }

  private shouldClearLiveDisplay(registry?: ResolvedSecretTraceRegistry): boolean {
    return !registry?.isComplete() || registry.getActiveMatches().length > 0
  }

  private async projectTraceSpans(traceSpans: TraceSpan[]): Promise<TraceSpan[]> {
    const sourceTraceSpans = await executionLogger.loadTraceSpansForProjection({
      executionId: this.executionId,
      workflowId: this.workflowId,
      workspaceId: this.environment?.workspaceId ?? null,
      traceSpans,
      isResume: this.isResume,
    })
    const registryBySpanId = new Map<string, ResolvedSecretTraceRegistry>()
    const secretSafeTraceSpans: TraceSpan[] = []
    for (const sourceSpan of sourceTraceSpans) {
      const projected = await this.projectTraceSpanTree(sourceSpan, registryBySpanId)
      if (projected) secretSafeTraceSpans.push(projected)
    }

    const preparedTraceSpans = await executionLogger.prepareTraceSpansForProjection({
      executionId: this.executionId,
      workflowId: this.workflowId,
      workspaceId: this.environment?.workspaceId ?? null,
      userId: this.actorUserId ?? this.environment?.userId,
      traceSpans: secretSafeTraceSpans,
    })

    const invariantSafeTraceSpans: TraceSpan[] = []
    for (const preparedSpan of preparedTraceSpans) {
      const invariantSafe = await this.enforceTraceSpanTreeInvariant(preparedSpan, registryBySpanId)
      if (invariantSafe) invariantSafeTraceSpans.push(invariantSafe)
    }
    return invariantSafeTraceSpans
  }

  private async projectTraceSpanTree(
    sourceSpan: TraceSpan,
    registryBySpanId: Map<string, ResolvedSecretTraceRegistry>,
    inheritedRegistry?: ResolvedSecretTraceRegistry
  ): Promise<TraceSpan | undefined> {
    const registry = sourceSpan.displayResolvedSecretTraceProvenance
      ? await this.createDisplayProjectionRegistry(sourceSpan.displayResolvedSecretTraceProvenance)
      : (inheritedRegistry ?? new ResolvedSecretTraceRegistry())
    if (registry) registryBySpanId.set(sourceSpan.id, registry)

    const { children, ...spanWithoutChildren } = sourceSpan
    const [projectedSpan] = await this.projectRawTraceSpans([spanWithoutChildren], registry)
    if (!projectedSpan) return undefined

    if (children === undefined) return projectedSpan

    const projectedChildren: TraceSpan[] = []
    for (const child of children) {
      const projectedChild = await this.projectTraceSpanTree(child, registryBySpanId, registry)
      if (projectedChild) projectedChildren.push(projectedChild)
    }
    return { ...projectedSpan, children: projectedChildren }
  }

  private async enforceTraceSpanTreeInvariant(
    span: TraceSpan,
    registryBySpanId: Map<string, ResolvedSecretTraceRegistry>
  ): Promise<TraceSpan | undefined> {
    const { children, ...spanWithoutChildren } = span
    const [invariantSafeSpan] = await enforceTraceSpanSecretInvariant([spanWithoutChildren], {
      registry: registryBySpanId.get(span.id),
      store: this.getSecretProjectionStore(),
    })
    if (!invariantSafeSpan) return undefined
    if (children === undefined) return invariantSafeSpan

    const invariantSafeChildren: TraceSpan[] = []
    for (const child of children) {
      const invariantSafeChild = await this.enforceTraceSpanTreeInvariant(child, registryBySpanId)
      if (invariantSafeChild) invariantSafeChildren.push(invariantSafeChild)
    }
    return { ...invariantSafeSpan, children: invariantSafeChildren }
  }

  async onBlockStart(
    blockId: string,
    blockName: string,
    blockType: string,
    startedAt: string
  ): Promise<void> {
    await this.trackProgressWrite(
      this.persistLastStartedBlock({
        blockId,
        blockName,
        blockType,
        startedAt,
      })
    )
  }

  /**
   * Persist the last-started-block marker. Redis is the primary path; falls back
   * to the durable jsonb_set UPDATE when Redis is unavailable or the write fails,
   * so a marker is never dropped.
   */
  private async persistLastStartedBlock(marker: ExecutionLastStartedBlock): Promise<void> {
    const expiresAt = this.executionDeadlineAt
      ? this.executionDeadlineAt.getTime() + RESERVATION_TTL_BUFFER_MS
      : undefined
    const stored =
      expiresAt === undefined
        ? await setLastStartedBlock(this.executionId, marker)
        : await setLastStartedBlock(this.executionId, marker, expiresAt)
    if (stored) {
      return
    }
    try {
      await execDb.execute(
        buildStartedMarkerPersistenceQuery({
          executionId: this.executionId,
          workflowId: this.workflowId,
          marker,
        })
      )
    } catch (error) {
      logger.error(`Failed to persist last started block for execution ${this.executionId}:`, {
        error: toError(error).message,
        cause: describeError(error),
        retryable: isRetryableInfrastructureError(error),
      })
    }
  }

  /**
   * Persist the last-completed-block marker. Redis is the primary path; falls
   * back to the durable jsonb_set UPDATE when Redis is unavailable or the write
   * fails, so a marker is never dropped.
   */
  private async persistLastCompletedBlock(marker: ExecutionLastCompletedBlock): Promise<void> {
    const expiresAt = this.executionDeadlineAt
      ? this.executionDeadlineAt.getTime() + RESERVATION_TTL_BUFFER_MS
      : undefined
    const stored =
      expiresAt === undefined
        ? await setLastCompletedBlock(this.executionId, marker)
        : await setLastCompletedBlock(this.executionId, marker, expiresAt)
    if (stored) {
      return
    }
    try {
      await execDb.execute(
        buildCompletedMarkerPersistenceQuery({
          executionId: this.executionId,
          workflowId: this.workflowId,
          marker,
        })
      )
    } catch (error) {
      logger.error(`Failed to persist last completed block for execution ${this.executionId}:`, {
        error: toError(error).message,
        cause: describeError(error),
        retryable: isRetryableInfrastructureError(error),
      })
    }
  }

  private async trackProgressWrite(writePromise: Promise<void>): Promise<void> {
    this.pendingProgressWrites.add(writePromise)

    try {
      await writePromise
    } finally {
      this.pendingProgressWrites.delete(writePromise)
    }
  }

  private async drainPendingProgressWrites(): Promise<void> {
    while (this.pendingProgressWrites.size > 0) {
      await Promise.allSettled(Array.from(this.pendingProgressWrites))
    }
  }

  /**
   * Writes the run's secret-usage trail.
   *
   * Here rather than at resolution time because this is the one funnel every terminal path
   * reaches, and because a per-resolution write would put a database round trip in the
   * executor's hot path. A paused run is skipped: its registry is persisted with the
   * resumable snapshot, and the resume's own terminal completion records the usage, so
   * counting here as well would double every human-in-the-loop run.
   *
   * A hard worker kill records nothing. That is the same gap the execution log row itself
   * has — it stays `running` — and it is not worth a hot-path write to close.
   */
  private recordResolvedSecretUsage(finalizationPath: ExecutionFinalizationPath): void {
    if (finalizationPath === 'paused') return

    if (!this.workspaceId) return

    const usage = this.resolvedSecretTraceRegistry?.getResolvedSecretUsage() ?? []
    recordSecretUsage(usage, {
      workspaceId: this.workspaceId,
      source: 'workflow',
      actorUserId: this.actorUserId,
      workflowId: this.workflowId,
      executionId: this.executionId,
      trigger: this.triggerType,
    })
  }

  private async completeExecutionWithFinalization(params: {
    endedAt: string
    totalDurationMs: number
    costSummary: {
      totalCost: number
      totalInputCost: number
      totalOutputCost: number
      totalTokens: number
      totalPromptTokens: number
      totalCompletionTokens: number
      baseExecutionCharge: number
      models: Record<
        string,
        {
          input: number
          output: number
          total: number
          tokens: { input: number; output: number; total: number }
        }
      >
      // Non-model billable charges (standalone tool/integration costs). Carried
      // through so the partition can't be silently dropped at this boundary.
      charges?: Record<string, { total: number }>
    }
    finalOutput: Record<string, unknown>
    traceSpans: TraceSpan[]
    workflowInput?: unknown
    executionState?: SerializableExecutionState
    finalOutputResolvedSecretTraceProvenance?: ResolvedSecretTraceProvenanceV1
    finalizationPath: ExecutionFinalizationPath
    completionFailure?: string
    level?: 'info' | 'error'
    status?: 'completed' | 'failed' | 'cancelled' | 'pending'
  }): Promise<void> {
    const executionState = this.withResolvedSecretTraceProvenance(
      params.executionState,
      params.finalizationPath === 'paused',
      params.finalOutputResolvedSecretTraceProvenance
    )
    const completedLog = await executionLogger.completeWorkflowExecution({
      executionId: this.executionId,
      endedAt: params.endedAt,
      totalDurationMs: params.totalDurationMs,
      costSummary: params.costSummary,
      finalOutput: params.finalOutput,
      traceSpans: params.traceSpans,
      workflowInput: params.workflowInput,
      executionState,
      finalizationPath: params.finalizationPath,
      completionFailure: params.completionFailure,
      isResume: this.isResume,
      level: params.level,
      status: params.status,
      actorUserId: this.actorUserId,
      billingAttribution: this.billingAttribution,
    })
    this.persistedCompletionStatus = completedLog.persistedStatus
    this.recordResolvedSecretUsage(params.finalizationPath)

    /**
     * Pause persistence releases only after the resumable snapshot is durable.
     * Releasing here would create a window where neither state nor reservation
     * protects the execution.
     */
    if (params.finalizationPath !== 'paused') {
      try {
        await releaseExecutionSlot(this.reservationId)
      } catch (error) {
        logger.warn(`Failed to release admission reservation for ${this.executionId}:`, {
          error: toError(error).message,
        })
      }
    }
  }

  private withResolvedSecretTraceProvenance(
    executionState: SerializableExecutionState | undefined,
    checkpoint: boolean,
    finalOutputResolvedSecretTraceProvenance?: ResolvedSecretTraceProvenanceV1
  ): SerializableExecutionState | undefined {
    if (!this.resolvedSecretTraceRegistry) return executionState

    const resolvedSecretTraceProvenance = checkpoint
      ? this.resolvedSecretTraceRegistry.exportCheckpointProvenance()
      : this.resolvedSecretTraceRegistry.exportProvenance()
    if (executionState) {
      return {
        ...executionState,
        resolvedSecretTraceProvenance,
        ...(finalOutputResolvedSecretTraceProvenance
          ? { finalOutputResolvedSecretTraceProvenance }
          : {}),
        resolvedSecretTraceCheckpointVersion: RESOLVED_SECRET_TRACE_CHECKPOINT_VERSION,
      }
    }

    return {
      blockStates: {},
      executedBlocks: [],
      blockLogs: [],
      decisions: { router: {}, condition: {} },
      completedLoops: [],
      activeExecutionPath: [],
      resolvedSecretTraceProvenance,
      ...(finalOutputResolvedSecretTraceProvenance
        ? { finalOutputResolvedSecretTraceProvenance }
        : {}),
      resolvedSecretTraceCheckpointVersion: RESOLVED_SECRET_TRACE_CHECKPOINT_VERSION,
    }
  }

  async onBlockComplete(
    blockId: string,
    blockName: string,
    blockType: string,
    output: any
  ): Promise<void> {
    // Cost is recorded into the usage_log ledger and reconciled at completion
    // boundaries (see recordExecutionUsage); onBlockComplete only persists the
    // last-completed-block progress marker.
    await this.trackProgressWrite(
      this.persistLastCompletedBlock({
        blockId,
        blockName,
        blockType,
        endedAt: output?.endedAt || new Date().toISOString(),
        success: !output?.output?.error,
      })
    )
  }

  async start(params: SessionStartParams): Promise<void> {
    const {
      userId,
      actorUserId,
      billingAttribution,
      workspaceId,
      variables,
      triggerData,
      skipLogCreation,
      deploymentVersionId,
      workflowState,
    } = params
    this.actorUserId = billingAttribution?.actorUserId ?? actorUserId ?? userId ?? null
    this.workspaceId = workspaceId
    this.billingAttribution = billingAttribution
    if (!this.resolvedSecretTraceRegistry) {
      const scopeUserId = userId ?? this.actorUserId
      this.resolvedSecretTraceRegistry = new ResolvedSecretTraceRegistry(
        [],
        scopeUserId ? { userId: scopeUserId, workspaceId } : undefined
      )
      if (skipLogCreation) this.resolvedSecretTraceRegistry.markIncomplete('log-creation-skipped')
    }

    try {
      const effectiveTriggerData = this.trustedExecutionCorrelation
        ? { ...triggerData, correlation: this.trustedExecutionCorrelation }
        : triggerData
      this.trigger = createTriggerObject(this.triggerType, effectiveTriggerData)
      this.correlation = effectiveTriggerData?.correlation
      this.environment = createEnvironmentObject(
        this.workflowId,
        this.executionId,
        userId,
        workspaceId,
        variables
      )
      this.workflowState =
        workflowState ??
        (deploymentVersionId
          ? await loadDeployedWorkflowStateForLogging(this.workflowId)
          : await loadWorkflowStateForExecution(this.workflowId))

      if (!skipLogCreation) {
        await executionLogger.startWorkflowExecution({
          workflowId: this.workflowId,
          workspaceId,
          executionId: this.executionId,
          trigger: this.trigger,
          environment: this.environment,
          actorUserId,
          billingAttribution,
          workflowState: this.workflowState,
          deploymentVersionId,
          executionDeadlineAt: this.executionDeadlineAt,
        })
      } else {
        // Resume: no cost reload needed. Billing reconciles from the usage_log
        // ledger (pre-pause rows already exist) plus the live cost summary.
        this.isResume = true
        await execDb
          .update(workflowExecutionLogs)
          .set({ status: 'running', executionDeadlineAt: this.executionDeadlineAt ?? null })
          .where(
            and(
              eq(workflowExecutionLogs.workflowId, this.workflowId),
              eq(workflowExecutionLogs.executionId, this.executionId),
              sql`${workflowExecutionLogs.status} IN ('pending', 'running', 'paused')`
            )
          )
      }
    } catch (error) {
      if (this.requestId) {
        logger.error(`[${this.requestId}] Failed to start logging:`, error)
      }
      throw error
    }
  }

  async complete(params: SessionCompleteParams = {}): Promise<void> {
    if (this.completed || this.completing) {
      return
    }
    this.completing = true

    const { endedAt, totalDurationMs, workflowInput, executionState } = params
    const finalOutput = params.finalOutput || {}
    const rawTraceSpans = params.traceSpans || []

    try {
      const costSummary = calculateCostSummary(rawTraceSpans, this.costOptions)
      const endTime = endedAt || new Date().toISOString()
      const duration = totalDurationMs || 0
      const hasErrors = traceSpansIndicateFailure(rawTraceSpans)
      const traceSpans = await this.projectTraceSpans(rawTraceSpans)

      await this.completeExecutionWithFinalization({
        endedAt: endTime,
        totalDurationMs: duration,
        costSummary,
        finalOutput,
        traceSpans,
        workflowInput,
        executionState,
        finalizationPath: 'completed',
        level: hasErrors ? 'error' : 'info',
        status: hasErrors ? 'failed' : 'completed',
      })

      this.completed = true

      if (traceSpans.length > 0) {
        try {
          const { PlatformEvents, createOTelSpansForWorkflowExecution } = await import(
            '@/lib/core/telemetry'
          )

          PlatformEvents.workflowExecuted({
            workflowId: this.workflowId,
            durationMs: duration,
            status: hasErrors ? 'error' : 'success',
            trigger: this.triggerType,
            blocksExecuted: traceSpans.length,
            hasErrors,
            totalCost: costSummary.totalCost || 0,
          })

          const startTime = new Date(new Date(endTime).getTime() - duration).toISOString()
          createOTelSpansForWorkflowExecution({
            workflowId: this.workflowId,
            workflowName: this.workflowState?.metadata?.name,
            executionId: this.executionId,
            traceSpans,
            trigger: this.triggerType,
            startTime,
            endTime,
            totalDurationMs: duration,
            status: hasErrors ? 'error' : 'success',
          })
        } catch (_e) {
          // Silently fail
        }
      }
    } catch (error) {
      this.completing = false
      logger.error(`Failed to complete logging for execution ${this.executionId}:`, {
        requestId: this.requestId,
        workflowId: this.workflowId,
        executionId: this.executionId,
        error: toError(error).message,
        stack: error instanceof Error ? error.stack : undefined,
        cause: describeError(error),
        retryable: isRetryableInfrastructureError(error),
      })
      throw error
    }
  }

  async completeWithError(params: SessionErrorCompleteParams = {}): Promise<void> {
    if (this.completed || this.completing) {
      return
    }
    this.completing = true

    try {
      const currentLog = await execDb
        .select({ status: workflowExecutionLogs.status })
        .from(workflowExecutionLogs)
        .where(
          and(
            eq(workflowExecutionLogs.workflowId, this.workflowId),
            eq(workflowExecutionLogs.executionId, this.executionId)
          )
        )
        .limit(1)
        .then((rows) => rows[0])

      if (currentLog?.status === 'cancelled') {
        this.persistedCompletionStatus = 'cancelled'
        this.completed = true
        return
      }

      const { endedAt, totalDurationMs, error, skipCost } = params
      const rawTraceSpans = params.traceSpans || []

      const endTime = endedAt ? new Date(endedAt) : new Date()
      const durationMs = typeof totalDurationMs === 'number' ? totalDurationMs : 0
      const startTime = new Date(endTime.getTime() - Math.max(1, durationMs))

      const hasProvidedSpans = rawTraceSpans.length > 0

      // calculateCostSummary([]) / (undefined) already returns the base-charge
      // summary, so the no-spans branch needs no separate literal.
      const costSummary = skipCost
        ? {
            totalCost: 0,
            totalInputCost: 0,
            totalOutputCost: 0,
            totalTokens: 0,
            totalPromptTokens: 0,
            totalCompletionTokens: 0,
            baseExecutionCharge: 0,
            models: {},
            charges: {},
          }
        : calculateCostSummary(rawTraceSpans, this.costOptions)

      const message = error?.message || 'Run failed before starting blocks'
      const errorDisplayProvenance = getActiveBlockDisplayProvenance(params.executionState)

      const errorSpan: TraceSpan = {
        id: 'workflow-error-root',
        name: 'Workflow Error',
        type: 'workflow',
        duration: Math.max(1, durationMs),
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        status: 'error',
        ...(hasProvidedSpans ? {} : { children: [] }),
        output: { error: message },
        ...(errorDisplayProvenance
          ? { displayResolvedSecretTraceProvenance: errorDisplayProvenance }
          : {}),
      }

      const spans = await this.projectTraceSpans(hasProvidedSpans ? rawTraceSpans : [errorSpan])

      await this.completeExecutionWithFinalization({
        endedAt: endTime.toISOString(),
        totalDurationMs: Math.max(1, durationMs),
        costSummary,
        finalOutput: { error: message },
        traceSpans: spans,
        executionState: params.executionState,
        finalOutputResolvedSecretTraceProvenance: errorDisplayProvenance,
        level: 'error',
        status: 'failed',
        finalizationPath: 'force_failed',
        completionFailure: message,
      })

      this.completed = true

      try {
        const { PlatformEvents, createOTelSpansForWorkflowExecution } = await import(
          '@/lib/core/telemetry'
        )
        PlatformEvents.workflowExecuted({
          workflowId: this.workflowId,
          durationMs: Math.max(1, durationMs),
          status: 'error',
          trigger: this.triggerType,
          blocksExecuted: spans.length,
          hasErrors: true,
        })

        createOTelSpansForWorkflowExecution({
          workflowId: this.workflowId,
          workflowName: this.workflowState?.metadata?.name,
          executionId: this.executionId,
          traceSpans: spans,
          trigger: this.triggerType,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          totalDurationMs: Math.max(1, durationMs),
          status: 'error',
        })
      } catch (_e) {
        // Silently fail
      }

      if (this.requestId) {
        logger.debug(
          `[${this.requestId}] Completed error logging for execution ${this.executionId}`
        )
      }
    } catch (enhancedError) {
      this.completing = false
      logger.error(`Failed to complete error logging for execution ${this.executionId}:`, {
        requestId: this.requestId,
        workflowId: this.workflowId,
        executionId: this.executionId,
        error: toError(enhancedError).message,
        stack: enhancedError instanceof Error ? enhancedError.stack : undefined,
      })
      throw enhancedError
    }
  }

  async completeWithCancellation(params: SessionCancelledParams = {}): Promise<void> {
    if (this.completed || this.completing) {
      return
    }
    this.completing = true

    try {
      const { endedAt, totalDurationMs } = params
      const rawTraceSpans = params.traceSpans || []

      const endTime = endedAt ? new Date(endedAt) : new Date()
      const durationMs = typeof totalDurationMs === 'number' ? totalDurationMs : 0

      // calculateCostSummary handles empty/undefined spans by returning the
      // base-charge summary, so no separate no-spans literal is needed.
      const costSummary = calculateCostSummary(rawTraceSpans, this.costOptions)
      const traceSpans = await this.projectTraceSpans(rawTraceSpans)

      await this.completeExecutionWithFinalization({
        endedAt: endTime.toISOString(),
        totalDurationMs: Math.max(1, durationMs),
        costSummary,
        finalOutput: { cancelled: true },
        traceSpans,
        executionState: params.executionState,
        finalOutputResolvedSecretTraceProvenance: emptyResolvedSecretTraceProvenance(),
        finalizationPath: 'cancelled',
        status: 'cancelled',
      })

      this.completed = true

      try {
        const { PlatformEvents, createOTelSpansForWorkflowExecution } = await import(
          '@/lib/core/telemetry'
        )
        PlatformEvents.workflowExecuted({
          workflowId: this.workflowId,
          durationMs: Math.max(1, durationMs),
          status: 'cancelled',
          trigger: this.triggerType,
          blocksExecuted: traceSpans.length,
          hasErrors: false,
        })

        if (traceSpans.length > 0) {
          const startTime = new Date(endTime.getTime() - Math.max(1, durationMs))
          createOTelSpansForWorkflowExecution({
            workflowId: this.workflowId,
            workflowName: this.workflowState?.metadata?.name,
            executionId: this.executionId,
            traceSpans,
            trigger: this.triggerType,
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString(),
            totalDurationMs: Math.max(1, durationMs),
            status: 'success', // Cancelled executions are not errors
          })
        }
      } catch (_e) {
        // Silently fail
      }

      if (this.requestId) {
        logger.debug(
          `[${this.requestId}] Completed cancelled logging for execution ${this.executionId}`
        )
      }
    } catch (cancelError) {
      this.completing = false
      logger.error(`Failed to complete cancelled logging for execution ${this.executionId}:`, {
        requestId: this.requestId,
        workflowId: this.workflowId,
        executionId: this.executionId,
        error: toError(cancelError).message,
        stack: cancelError instanceof Error ? cancelError.stack : undefined,
      })
      throw cancelError
    }
  }

  async completeWithPause(params: SessionPausedParams = {}): Promise<void> {
    if (this.completed || this.completing) {
      return
    }
    this.completing = true

    try {
      const { endedAt, totalDurationMs, workflowInput } = params
      const rawTraceSpans = params.traceSpans || []

      const endTime = endedAt ? new Date(endedAt) : new Date()
      const durationMs = typeof totalDurationMs === 'number' ? totalDurationMs : 0

      const currentLog = await execDb
        .select({ status: workflowExecutionLogs.status })
        .from(workflowExecutionLogs)
        .where(
          and(
            eq(workflowExecutionLogs.workflowId, this.workflowId),
            eq(workflowExecutionLogs.executionId, this.executionId)
          )
        )
        .limit(1)
        .then((rows) => rows[0])

      if (currentLog?.status === 'cancelled') {
        this.persistedCompletionStatus = 'cancelled'
        this.completed = true
        return
      }

      // calculateCostSummary handles empty/undefined spans by returning the
      // base-charge summary, so no separate no-spans literal is needed.
      const costSummary = calculateCostSummary(rawTraceSpans, this.costOptions)
      const traceSpans = await this.projectTraceSpans(rawTraceSpans)

      await this.completeExecutionWithFinalization({
        endedAt: endTime.toISOString(),
        totalDurationMs: Math.max(1, durationMs),
        costSummary,
        finalOutput: { paused: true },
        traceSpans,
        workflowInput,
        executionState: params.executionState,
        finalOutputResolvedSecretTraceProvenance: emptyResolvedSecretTraceProvenance(),
        finalizationPath: 'paused',
        status: 'pending',
      })

      this.completed = true

      try {
        const { PlatformEvents, createOTelSpansForWorkflowExecution } = await import(
          '@/lib/core/telemetry'
        )
        PlatformEvents.workflowExecuted({
          workflowId: this.workflowId,
          durationMs: Math.max(1, durationMs),
          status: 'paused',
          trigger: this.triggerType,
          blocksExecuted: traceSpans.length,
          hasErrors: false,
          totalCost: costSummary.totalCost || 0,
        })

        if (traceSpans.length > 0) {
          const startTime = new Date(endTime.getTime() - Math.max(1, durationMs))
          createOTelSpansForWorkflowExecution({
            workflowId: this.workflowId,
            workflowName: this.workflowState?.metadata?.name,
            executionId: this.executionId,
            traceSpans,
            trigger: this.triggerType,
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString(),
            totalDurationMs: Math.max(1, durationMs),
            status: 'success', // Paused executions are not errors
          })
        }
      } catch (_e) {}

      if (this.requestId) {
        logger.debug(
          `[${this.requestId}] Completed paused logging for execution ${this.executionId}`
        )
      }
    } catch (pauseError) {
      this.completing = false
      logger.error(`Failed to complete paused logging for execution ${this.executionId}:`, {
        requestId: this.requestId,
        workflowId: this.workflowId,
        executionId: this.executionId,
        error: toError(pauseError).message,
        stack: pauseError instanceof Error ? pauseError.stack : undefined,
      })
      throw pauseError
    }
  }

  async safeStart(params: SessionStartParams): Promise<boolean> {
    try {
      await this.start(params)
      return true
    } catch (error) {
      if (this.requestId) {
        logger.warn(
          `[${this.requestId}] Logging start failed - falling back to minimal session:`,
          error
        )
      }

      // Fallback: create a minimal logging session without full workflow state
      try {
        const {
          userId,
          actorUserId,
          billingAttribution,
          workspaceId,
          variables,
          triggerData,
          deploymentVersionId,
          workflowState,
        } = params
        const effectiveTriggerData = this.trustedExecutionCorrelation
          ? { ...triggerData, correlation: this.trustedExecutionCorrelation }
          : triggerData
        this.trigger = createTriggerObject(this.triggerType, effectiveTriggerData)
        this.correlation = effectiveTriggerData?.correlation
        this.environment = createEnvironmentObject(
          this.workflowId,
          this.executionId,
          userId,
          workspaceId,
          variables
        )
        const fallbackWorkflowState: WorkflowState = workflowState ?? {
          blocks: {},
          edges: [],
          loops: {},
          parallels: {},
        }
        this.workflowState = fallbackWorkflowState

        await executionLogger.startWorkflowExecution({
          workflowId: this.workflowId,
          workspaceId,
          executionId: this.executionId,
          trigger: this.trigger,
          environment: this.environment,
          actorUserId,
          billingAttribution,
          workflowState: this.workflowState,
          deploymentVersionId,
          executionDeadlineAt: this.executionDeadlineAt,
        })

        if (this.requestId) {
          logger.debug(
            `[${this.requestId}] Started minimal logging for execution ${this.executionId}`
          )
        }
        return true
      } catch (fallbackError) {
        if (this.requestId) {
          logger.error(`[${this.requestId}] Minimal logging start also failed:`, fallbackError)
        }
        return false
      }
    }
  }

  /**
   * Wait for any in-flight fire-and-forget completion to finish.
   * Called internally by markAsFailed to ensure completion has settled
   * before overwriting execution status.
   */
  async waitForCompletion(): Promise<void> {
    if (this.completionPromise) {
      try {
        await this.completionPromise
      } catch {
        /* already handled by safe* wrapper */
      }
    }
  }

  setPostExecutionPromise(promise: Promise<void>): void {
    this.postExecutionPromise = promise
  }

  async waitForPostExecution(): Promise<void> {
    if (this.postExecutionPromise) {
      try {
        await this.postExecutionPromise
      } catch {
        /* already handled inside the IIFE */
      }
    }
  }

  hasCompleted(): boolean {
    return this.completed
  }

  getPersistedCompletionStatus(): PersistedWorkflowExecutionStatus | null {
    return this.persistedCompletionStatus
  }

  private shouldStartNewCompletionAttempt(attempt: CompletionAttempt): boolean {
    return this.completionAttemptFailed && this.completionAttempt !== 'error' && attempt === 'error'
  }

  private runCompletionAttempt(
    attempt: CompletionAttempt,
    run: () => Promise<void>
  ): Promise<void> {
    if (this.completionPromise && !this.shouldStartNewCompletionAttempt(attempt)) {
      return this.completionPromise
    }

    this.completionAttempt = attempt
    this.completionAttemptFailed = false
    this.completionPromise = run()
      .then(() => {
        // Copilot background tasks watching this execution learn its outcome here — the
        // one point every run's completion passes through, sync or async.
        void notifyWorkflowRunTasks({
          executionId: this.executionId,
          workflowId: this.workflowId,
          status:
            attempt === 'error'
              ? 'failed'
              : this.persistedCompletionStatus === 'cancelled'
                ? 'cancelled'
                : this.persistedCompletionStatus === 'failed'
                  ? 'failed'
                  : 'completed',
          error: this.lastCompletionError ?? null,
        }).catch(() => undefined)
      })
      .catch((error) => {
        this.completionAttemptFailed = true
        throw error
      })
    return this.completionPromise
  }

  /**
   * A secret-safe copy of `traceSpans`, projected against THIS session's registry.
   *
   * Exists for one case: a custom block handing its child's spans to an already-authorized
   * live viewer. Those spans must be projected against the CHILD's registry — the invoking
   * run's session knows nothing about the publisher's secrets, so projecting them there
   * would leave a source-owner credential unmasked in the consumer's stream. Unlike the
   * completion path this does no persistence prep; it is display-only.
   *
   * Fails closed via {@link projectTraceSpansForSecrets}: an incomplete registry yields
   * structure with no content rather than unprojected values.
   */
  async projectTraceSpansForLiveDisplay(traceSpans: TraceSpan[]): Promise<TraceSpan[]> {
    return this.projectRawTraceSpans(traceSpans)
  }

  async safeComplete(params: SessionCompleteParams = {}): Promise<void> {
    return this.runCompletionAttempt('complete', () => this._safeCompleteImpl(params))
  }

  private async _safeCompleteImpl(params: SessionCompleteParams = {}): Promise<void> {
    try {
      await this.drainPendingProgressWrites()
      await this.complete(params)
    } catch (error) {
      const errorMsg = toError(error).message
      logger.warn(
        `[${this.requestId || 'unknown'}] Complete failed for execution ${this.executionId}, attempting fallback`,
        { error: errorMsg }
      )
      await this.completeWithCostOnlyLog({
        traceSpans: params.traceSpans,
        endedAt: params.endedAt,
        totalDurationMs: params.totalDurationMs,
        errorMessage: `Failed to store trace spans: ${errorMsg}`,
        isError: false,
        finalizationPath: 'fallback_completed',
        finalOutput: params.finalOutput || {},
        executionState: params.executionState,
      })
    }
  }

  async safeCompleteWithError(params?: SessionErrorCompleteParams): Promise<void> {
    this.lastCompletionError = params?.error?.message ?? null
    return this.runCompletionAttempt('error', () => this._safeCompleteWithErrorImpl(params))
  }

  private async _safeCompleteWithErrorImpl(params?: SessionErrorCompleteParams): Promise<void> {
    try {
      await this.drainPendingProgressWrites()
      await this.completeWithError(params)
    } catch (error) {
      const errorMsg = toError(error).message
      logger.warn(
        `[${this.requestId || 'unknown'}] CompleteWithError failed for execution ${this.executionId}, attempting fallback`,
        { error: errorMsg }
      )
      await this.completeWithCostOnlyLog({
        traceSpans: params?.traceSpans,
        endedAt: params?.endedAt,
        totalDurationMs: params?.totalDurationMs,
        errorMessage:
          params?.error?.message || `Execution failed to store trace spans: ${errorMsg}`,
        isError: true,
        finalizationPath: 'force_failed',
        finalOutput: {
          error: params?.error?.message || `Execution failed to store trace spans: ${errorMsg}`,
        },
        executionState: params?.executionState,
        status: 'failed',
      })
    }
  }

  async safeCompleteWithCancellation(params?: SessionCancelledParams): Promise<void> {
    return this.runCompletionAttempt('cancelled', () =>
      this._safeCompleteWithCancellationImpl(params)
    )
  }

  private async _safeCompleteWithCancellationImpl(params?: SessionCancelledParams): Promise<void> {
    try {
      await this.drainPendingProgressWrites()
      await this.completeWithCancellation(params)
    } catch (error) {
      const errorMsg = toError(error).message
      logger.warn(
        `[${this.requestId || 'unknown'}] CompleteWithCancellation failed for execution ${this.executionId}, attempting fallback`,
        { error: errorMsg }
      )
      await this.completeWithCostOnlyLog({
        traceSpans: params?.traceSpans,
        endedAt: params?.endedAt,
        totalDurationMs: params?.totalDurationMs,
        errorMessage: 'Run was cancelled',
        isError: false,
        finalizationPath: 'cancelled',
        finalOutput: { cancelled: true },
        executionState: params?.executionState,
        status: 'cancelled',
      })
    }
  }

  async safeCompleteWithPause(params?: SessionPausedParams): Promise<void> {
    return this.runCompletionAttempt('paused', () => this._safeCompleteWithPauseImpl(params))
  }

  private async _safeCompleteWithPauseImpl(params?: SessionPausedParams): Promise<void> {
    try {
      await this.drainPendingProgressWrites()
      await this.completeWithPause(params)
    } catch (error) {
      const errorMsg = toError(error).message
      logger.warn(
        `[${this.requestId || 'unknown'}] CompleteWithPause failed for execution ${this.executionId}, attempting fallback`,
        { error: errorMsg }
      )
      await this.completeWithCostOnlyLog({
        traceSpans: params?.traceSpans,
        endedAt: params?.endedAt,
        totalDurationMs: params?.totalDurationMs,
        errorMessage: 'Run paused but failed to store full trace spans',
        isError: false,
        finalizationPath: 'paused',
        finalOutput: { paused: true },
        executionState: params?.executionState,
        status: 'pending',
      })
    }
  }

  /**
   * Force-fail the execution. Waits for any in-flight completion and drains
   * pending per-block marker writes first, so a force-fail racing
   * onBlockStart/onBlockComplete still captures the latest breadcrumb in the fold.
   */
  async markAsFailed(errorMessage?: string): Promise<void> {
    await this.waitForCompletion()
    await this.drainPendingProgressWrites()
    await LoggingSession.markExecutionAsFailed(
      this.executionId,
      errorMessage,
      this.requestId,
      this.workflowId
    )
    await releaseExecutionSlot(this.reservationId)
  }

  /**
   * Force-fail terminal boundary that bypasses completeWorkflowExecution. Folds
   * any live Redis progress markers into execution_data before clearing the key,
   * so a run whose markers only ever lived in Redis still keeps its
   * last-started/last-completed breadcrumb. Both the fold and clear are no-ops
   * when the standard completion path already persisted and cleared them.
   */
  static async markExecutionAsFailed(
    executionId: string,
    errorMessage: string | undefined,
    requestId: string | undefined,
    workflowId: string
  ): Promise<void> {
    try {
      const message = errorMessage || 'Run failed'

      const markers = await getProgressMarkers(executionId)

      let executionData = sql`jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(
                  COALESCE(execution_data, '{}'::jsonb),
                  ARRAY['secretProjectionVersion'],
                  to_jsonb(${SECRET_PROJECTION_VERSION}::integer)
                ),
                ARRAY['error'],
                to_jsonb(${message}::text)
              ),
              ARRAY['finalOutput'],
              jsonb_build_object('error', ${message}::text)
            ),
            ARRAY['finalizationPath'],
            to_jsonb('force_failed'::text)
          )`
      if (markers?.lastStartedBlock) {
        const startedAt = markers.lastStartedBlock.startedAt
        const startedJson = JSON.stringify(markers.lastStartedBlock)
        executionData = sql`CASE WHEN COALESCE(jsonb_extract_path_text(execution_data, 'lastStartedBlock', 'startedAt'), '') <= ${startedAt}
            THEN jsonb_set(${executionData}, ARRAY['lastStartedBlock'], ${startedJson}::jsonb)
            ELSE ${executionData} END`
      }
      if (markers?.lastCompletedBlock) {
        const endedAt = markers.lastCompletedBlock.endedAt
        const completedJson = JSON.stringify(markers.lastCompletedBlock)
        executionData = sql`CASE WHEN COALESCE(jsonb_extract_path_text(execution_data, 'lastCompletedBlock', 'endedAt'), '') <= ${endedAt}
            THEN jsonb_set(${executionData}, ARRAY['lastCompletedBlock'], ${completedJson}::jsonb)
            ELSE ${executionData} END`
      }

      await execDb
        .update(workflowExecutionLogs)
        .set({
          level: 'error',
          ...terminalExecutionLogFields('failed', new Date()),
          executionData,
        })
        .where(
          and(
            eq(workflowExecutionLogs.executionId, executionId),
            eq(workflowExecutionLogs.workflowId, workflowId),
            sql`${workflowExecutionLogs.status} != 'cancelled'`
          )
        )

      if (markers !== null) void clearProgressMarkers(executionId)

      logger.info(`[${requestId || 'unknown'}] Marked execution ${executionId} as failed`)
    } catch (error) {
      logger.error(`Failed to mark execution ${executionId} as failed:`, {
        error: toError(error).message,
      })
    }
  }

  private async completeWithCostOnlyLog(params: {
    traceSpans?: TraceSpan[]
    endedAt?: string
    totalDurationMs?: number
    errorMessage: string
    isError: boolean
    finalizationPath: ExecutionFinalizationPath
    finalOutput?: Record<string, unknown>
    executionState?: SerializableExecutionState
    status?: 'completed' | 'failed' | 'cancelled' | 'pending'
  }): Promise<void> {
    if (this.completed || this.completing) {
      return
    }
    this.completing = true

    logger.warn(
      `[${this.requestId || 'unknown'}] Logging completion failed for execution ${this.executionId} - attempting cost-only fallback`
    )

    try {
      // Billing is reconciled from the usage_log ledger in recordExecutionUsage;
      // here we only need a cost summary to compute the run total. Derive it
      // from the in-memory trace spans when available (this fallback fires when
      // persisting spans failed, not when computing them did), else just the
      // base execution charge.
      const costSummary = calculateCostSummary(params.traceSpans, this.costOptions)

      const finalOutput = params.finalOutput || { _fallback: true, error: params.errorMessage }

      await this.completeExecutionWithFinalization({
        endedAt: params.endedAt || new Date().toISOString(),
        totalDurationMs: params.totalDurationMs || 0,
        costSummary,
        finalOutput,
        traceSpans: [],
        executionState: params.executionState,
        finalizationPath: params.finalizationPath,
        completionFailure: params.errorMessage,
        level: params.isError ? 'error' : 'info',
        status: params.status,
      })

      this.completed = true

      logger.info(
        `[${this.requestId || 'unknown'}] Cost-only fallback succeeded for execution ${this.executionId}`
      )
    } catch (fallbackError) {
      this.completing = false
      this.completionAttemptFailed = true
      logger.error(
        `[${this.requestId || 'unknown'}] Cost-only fallback also failed for execution ${this.executionId}:`,
        {
          error: toError(fallbackError).message,
          cause: describeError(fallbackError),
          retryable: isRetryableInfrastructureError(fallbackError),
        }
      )
    }
  }
}
