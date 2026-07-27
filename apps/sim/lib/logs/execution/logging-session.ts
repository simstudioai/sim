import { dbFor } from '@sim/db'
import { workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { describeError, toError } from '@sim/utils/errors'
import { and, eq, sql } from 'drizzle-orm'
import { releaseExecutionSlot } from '@/lib/billing/calculations/usage-reservation'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import { isRetryableInfrastructureError } from '@/lib/core/errors/retryable-infrastructure'
import { executionLogger } from '@/lib/logs/execution/logger'
import {
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
import type {
  ExecutionEnvironment,
  ExecutionFinalizationPath,
  ExecutionLastCompletedBlock,
  ExecutionLastStartedBlock,
  ExecutionTrigger,
  TraceSpan,
  WorkflowState,
} from '@/lib/logs/types'
import type { SerializableExecutionState } from '@/executor/execution/types'

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

const logger = createLogger('LoggingSession')

type CompletionAttempt = 'complete' | 'error' | 'cancelled' | 'paused'

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
}

export interface SessionCancelledParams {
  endedAt?: string
  totalDurationMs?: number
  traceSpans?: TraceSpan[]
}

export interface SessionPausedParams {
  endedAt?: string
  totalDurationMs?: number
  traceSpans?: TraceSpan[]
  workflowInput?: any
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
  private actorUserId: string | null = null
  private billingAttribution?: BillingAttributionSnapshot
  private isResume = false
  private completed = false
  /** Synchronous flag to prevent concurrent completion attempts (race condition guard) */
  private completing = false
  /** Tracks the in-flight completion promise so callers can await it */
  private completionPromise: Promise<void> | null = null
  private completionAttempt: CompletionAttempt | null = null
  private completionAttemptFailed = false
  private pendingProgressWrites = new Set<Promise<void>>()
  private postExecutionPromise: Promise<void> | null = null

  constructor(
    workflowId: string,
    executionId: string,
    triggerType: ExecutionTrigger['type'],
    requestId?: string,
    reservationId = executionId
  ) {
    this.workflowId = workflowId
    this.executionId = executionId
    this.reservationId = reservationId
    this.triggerType = triggerType
    this.requestId = requestId
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
    if (await setLastStartedBlock(this.executionId, marker)) {
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
    if (await setLastCompletedBlock(this.executionId, marker)) {
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
    finalizationPath: ExecutionFinalizationPath
    completionFailure?: string
    level?: 'info' | 'error'
    status?: 'completed' | 'failed' | 'cancelled' | 'pending'
  }): Promise<void> {
    await executionLogger.completeWorkflowExecution({
      executionId: this.executionId,
      endedAt: params.endedAt,
      totalDurationMs: params.totalDurationMs,
      costSummary: params.costSummary,
      finalOutput: params.finalOutput,
      traceSpans: params.traceSpans,
      workflowInput: params.workflowInput,
      executionState: params.executionState,
      finalizationPath: params.finalizationPath,
      completionFailure: params.completionFailure,
      isResume: this.isResume,
      level: params.level,
      status: params.status,
      actorUserId: this.actorUserId,
      billingAttribution: this.billingAttribution,
    })

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
    this.billingAttribution = billingAttribution

    try {
      this.trigger = createTriggerObject(this.triggerType, triggerData)
      this.correlation = triggerData?.correlation
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
        })
      } else {
        // Resume: no cost reload needed. Billing reconciles from the usage_log
        // ledger (pre-pause rows already exist) plus the live cost summary.
        this.isResume = true
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

    const { endedAt, totalDurationMs, finalOutput, traceSpans, workflowInput, executionState } =
      params

    try {
      const costSummary = calculateCostSummary(traceSpans || [])
      const endTime = endedAt || new Date().toISOString()
      const duration = totalDurationMs || 0

      await this.completeExecutionWithFinalization({
        endedAt: endTime,
        totalDurationMs: duration,
        costSummary,
        finalOutput: finalOutput || {},
        traceSpans: traceSpans || [],
        workflowInput,
        executionState,
        finalizationPath: 'completed',
      })

      this.completed = true

      if (traceSpans && traceSpans.length > 0) {
        try {
          const { PlatformEvents, createOTelSpansForWorkflowExecution } = await import(
            '@/lib/core/telemetry'
          )

          const hasErrors = traceSpans.some((span: any) => {
            const checkForErrors = (s: any): boolean => {
              if (s.status === 'error' && !s.errorHandled) return true
              if (s.children && Array.isArray(s.children)) {
                return s.children.some(checkForErrors)
              }
              return false
            }
            return checkForErrors(span)
          })

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
        this.completed = true
        return
      }

      const { endedAt, totalDurationMs, error, traceSpans, skipCost } = params

      const endTime = endedAt ? new Date(endedAt) : new Date()
      const durationMs = typeof totalDurationMs === 'number' ? totalDurationMs : 0
      const startTime = new Date(endTime.getTime() - Math.max(1, durationMs))

      const hasProvidedSpans = Array.isArray(traceSpans) && traceSpans.length > 0

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
        : calculateCostSummary(traceSpans)

      const message = error?.message || 'Run failed before starting blocks'

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
      }

      const spans = hasProvidedSpans ? traceSpans : [errorSpan]

      await this.completeExecutionWithFinalization({
        endedAt: endTime.toISOString(),
        totalDurationMs: Math.max(1, durationMs),
        costSummary,
        finalOutput: { error: message },
        traceSpans: spans,
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
          errorMessage: message,
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
          error: message,
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
      const { endedAt, totalDurationMs, traceSpans } = params

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
        this.completed = true
        return
      }

      // calculateCostSummary handles empty/undefined spans by returning the
      // base-charge summary, so no separate no-spans literal is needed.
      const costSummary = calculateCostSummary(traceSpans)

      await this.completeExecutionWithFinalization({
        endedAt: endTime.toISOString(),
        totalDurationMs: Math.max(1, durationMs),
        costSummary,
        finalOutput: { cancelled: true },
        traceSpans: traceSpans || [],
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
          blocksExecuted: traceSpans?.length || 0,
          hasErrors: false,
        })

        if (traceSpans && traceSpans.length > 0) {
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
      const { endedAt, totalDurationMs, traceSpans, workflowInput } = params

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
        this.completed = true
        return
      }

      // calculateCostSummary handles empty/undefined spans by returning the
      // base-charge summary, so no separate no-spans literal is needed.
      const costSummary = calculateCostSummary(traceSpans)

      await this.completeExecutionWithFinalization({
        endedAt: endTime.toISOString(),
        totalDurationMs: Math.max(1, durationMs),
        costSummary,
        finalOutput: { paused: true },
        traceSpans: traceSpans || [],
        workflowInput,
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
          blocksExecuted: traceSpans?.length || 0,
          hasErrors: false,
          totalCost: costSummary.totalCost || 0,
        })

        if (traceSpans && traceSpans.length > 0) {
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
        this.trigger = createTriggerObject(this.triggerType, triggerData)
        this.correlation = triggerData?.correlation
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
    this.completionPromise = run().catch((error) => {
      this.completionAttemptFailed = true
      throw error
    })
    return this.completionPromise
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
      })
    }
  }

  async safeCompleteWithError(params?: SessionErrorCompleteParams): Promise<void> {
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
                COALESCE(execution_data, '{}'::jsonb),
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
        .set({ level: 'error', status: 'failed', executionData })
        .where(
          and(
            eq(workflowExecutionLogs.executionId, executionId),
            eq(workflowExecutionLogs.workflowId, workflowId)
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
      const costSummary = calculateCostSummary(params.traceSpans)

      const finalOutput = params.finalOutput || { _fallback: true, error: params.errorMessage }

      await this.completeExecutionWithFinalization({
        endedAt: params.endedAt || new Date().toISOString(),
        totalDurationMs: params.totalDurationMs || 0,
        costSummary,
        finalOutput,
        traceSpans: [],
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
