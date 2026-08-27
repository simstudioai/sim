import { db } from '@sim/db'
import { workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { and, eq, inArray } from 'drizzle-orm'
import { releaseExecutionSlot } from '@/lib/billing/calculations/usage-reservation'
import { getJobQueue } from '@/lib/core/async-jobs'
import type { ExecutionJobCancellationScope } from '@/lib/core/async-jobs/types'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  clearExecutionCancellation,
  type ExecutionCancellationRecordResult,
  markExecutionCancelled,
} from '@/lib/execution/cancellation'
import { createExecutionEventWriter, readExecutionMetaState } from '@/lib/execution/event-buffer'
import { abortManualExecution } from '@/lib/execution/manual-cancellation'
import {
  isWorkflowRunAlreadyTerminalStatus,
  WorkflowRunAlreadyTerminalError,
} from '@/lib/execution/workflow-run-already-terminal-error'
import { cancelledExecutionLogFields } from '@/lib/logs/execution/cancellation'
import { workflowExecutionOriginSql } from '@/lib/logs/execution-origin'
import {
  cancelWorkflowGroupExecution,
  type PublishableWorkflowGroupCancellation,
  publishWorkflowGroupCancellationEvent,
} from '@/lib/table/workflow-group-cancellation'
import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'

const logger = createLogger('CancelWorkflowExecution')
const PAUSED_CANCELLATION_DB_ATTEMPTS = 3
const PAUSED_CANCELLATION_DB_RETRY_MS = 200
const CANCELLATION_ABORTED_MESSAGE =
  'Request aborted before workflow run cancellation could be applied.'

export type CancelWorkflowExecutionReason =
  | 'recorded'
  | 'already_cancelled'
  | 'already_completed'
  | 'already_failed'
  | 'redis_unavailable'
  | 'redis_write_failed'
  | 'paused_event_publish_failed'
  | 'paused_database_cancel_failed'
  | 'queue_cancelled'
  | 'active_resume_signal_failed'
  | 'cancellation_not_finalized'

export interface CancelWorkflowExecutionResult {
  success: boolean
  executionId: string
  redisAvailable: boolean
  durablyRecorded: boolean
  locallyAborted: boolean
  pausedCancelled: boolean
  reason?: CancelWorkflowExecutionReason
}

async function cancelQueuedExecutionJobs(
  workflowId: string,
  executionId: string,
  scope: ExecutionJobCancellationScope
): Promise<number> {
  try {
    const queue = await getJobQueue()
    return await queue.cancelByExecution({ workflowId, executionId }, scope)
  } catch (error) {
    logger.warn('Failed to cancel queued execution jobs', {
      workflowId,
      executionId,
      error: toError(error).message,
    })
    return 0
  }
}

function abortLocalExecution(executionId: string): boolean {
  try {
    return abortManualExecution(executionId)
  } catch (error) {
    logger.warn('Failed to abort local execution', {
      executionId,
      error: toError(error).message,
    })
    return false
  }
}

interface ExecutionStopSignalResult {
  cancellation: ExecutionCancellationRecordResult
  locallyAborted: boolean
  queueJobsCancelled: number
  accepted: boolean
}

interface ExecutionStopSummary extends ExecutionStopSignalResult {
  signalledExecutionIds: Set<string>
}

type ActiveResumeCancellationTarget = NonNullable<
  Awaited<ReturnType<typeof PauseResumeManager.getActiveResumeCancellationTarget>>
>

function createExecutionStopSummary(): ExecutionStopSummary {
  return {
    cancellation: { durablyRecorded: false, reason: 'redis_unavailable' },
    locallyAborted: false,
    queueJobsCancelled: 0,
    accepted: false,
    signalledExecutionIds: new Set<string>(),
  }
}

function mergeExecutionStopSignal(
  summary: ExecutionStopSummary,
  signalExecutionId: string,
  result: ExecutionStopSignalResult
): void {
  if (result.cancellation.durablyRecorded || !summary.cancellation.durablyRecorded) {
    summary.cancellation = result.cancellation
  }
  summary.locallyAborted = summary.locallyAborted || result.locallyAborted
  summary.queueJobsCancelled += result.queueJobsCancelled
  summary.accepted = summary.accepted || result.accepted
  summary.signalledExecutionIds.add(signalExecutionId)
}

/**
 * Commits cancellation after the caller's final abort check. Once signalling begins, the
 * operation must finish reconciliation because workers may already have observed the durable,
 * local, or queued signal; attempting to honor a later abort could revive only part of a run.
 */
async function signalExecutionStop(args: {
  workflowId: string
  signalExecutionId: string
  queueBindingExecutionId?: string
  executionDeadlineAt: Date | null
  queueScope?: ExecutionJobCancellationScope
}): Promise<ExecutionStopSignalResult> {
  const cancellation = await markExecutionCancelled(args.signalExecutionId, {
    executionDeadlineAt: args.executionDeadlineAt,
  })
  const locallyAborted = abortLocalExecution(args.signalExecutionId)
  const queueJobsCancelled = args.queueScope
    ? await cancelQueuedExecutionJobs(
        args.workflowId,
        args.queueBindingExecutionId ?? args.signalExecutionId,
        args.queueScope
      )
    : 0
  return {
    cancellation,
    locallyAborted,
    queueJobsCancelled,
    accepted: cancellation.durablyRecorded || locallyAborted || queueJobsCancelled > 0,
  }
}

async function signalAndRecordActiveResumeStop(args: {
  workflowId: string
  executionId: string
  executionDeadlineAt: Date | null
  target: ActiveResumeCancellationTarget
  summary: ExecutionStopSummary
}): Promise<boolean> {
  const signal = await signalExecutionStop({
    workflowId: args.workflowId,
    signalExecutionId: args.target.resumeExecutionId,
    queueBindingExecutionId: args.executionId,
    executionDeadlineAt: args.executionDeadlineAt,
    queueScope: 'resume',
  })
  mergeExecutionStopSignal(args.summary, args.target.resumeExecutionId, signal)
  return didActiveResumeStop(args.executionId, args.workflowId, args.target, signal)
}

async function didActiveResumeStop(
  executionId: string,
  workflowId: string,
  target: ActiveResumeCancellationTarget,
  signal: ExecutionStopSignalResult
): Promise<boolean> {
  if (signal.accepted) return true
  const currentTarget = await PauseResumeManager.getActiveResumeCancellationTarget(
    executionId,
    workflowId
  )
  if (currentTarget && currentTarget.resumeEntryId !== target.resumeEntryId) {
    logger.warn('A replacement resume became active while cancellation was staged', {
      executionId,
      previousResumeEntryId: target.resumeEntryId,
      currentResumeEntryId: currentTarget.resumeEntryId,
    })
  }
  return currentTarget === null
}

type PausedCancellationStage = Awaited<
  ReturnType<typeof PauseResumeManager.stagePausedCancellation>
>

function isPausedCancellationStage(
  stage: PausedCancellationStage
): stage is Exclude<PausedCancellationStage, { kind: 'not_paused' }> {
  return stage.kind !== 'not_paused'
}

async function clearStopSignalMarkers(summary: ExecutionStopSummary): Promise<void> {
  await Promise.all(
    [...summary.signalledExecutionIds].map((executionId) => clearExecutionCancellation(executionId))
  )
}

type ExecutionLogCancellationClaim =
  | { kind: 'cancelled' }
  | { kind: 'conflict'; status: string }
  | { kind: 'not_found' }

async function claimExecutionLogCancellation(args: {
  executionId: string
  workflowId: string
  workspaceId: string
}): Promise<ExecutionLogCancellationClaim> {
  const now = new Date()
  const [cancelledExecution] = await db
    .update(workflowExecutionLogs)
    .set(cancelledExecutionLogFields(now))
    .where(
      and(
        eq(workflowExecutionLogs.executionId, args.executionId),
        eq(workflowExecutionLogs.workflowId, args.workflowId),
        eq(workflowExecutionLogs.workspaceId, args.workspaceId),
        inArray(workflowExecutionLogs.status, ['running', 'pending'])
      )
    )
    .returning({ status: workflowExecutionLogs.status })

  if (cancelledExecution?.status === 'cancelled') return { kind: 'cancelled' }

  const currentExecution = await db
    .select({ status: workflowExecutionLogs.status })
    .from(workflowExecutionLogs)
    .where(
      and(
        eq(workflowExecutionLogs.executionId, args.executionId),
        eq(workflowExecutionLogs.workflowId, args.workflowId),
        eq(workflowExecutionLogs.workspaceId, args.workspaceId)
      )
    )
    .limit(1)
    .then((rows) => rows[0])

  if (!currentExecution) return { kind: 'not_found' }
  if (currentExecution.status === 'cancelled') return { kind: 'cancelled' }
  return { kind: 'conflict', status: currentExecution.status }
}

async function completePausedCancellationWithRetry(
  executionId: string,
  workflowId: string,
  options: { logMissing?: boolean } = {}
): Promise<boolean> {
  for (let attempt = 1; attempt <= PAUSED_CANCELLATION_DB_ATTEMPTS; attempt++) {
    try {
      const cancelled = await PauseResumeManager.completePausedCancellation(executionId, workflowId)
      if (cancelled) {
        logger.info('Paused execution cancelled in database', { executionId, attempt })
        return true
      }
      if (options.logMissing !== false) {
        logger.warn('Paused execution cancellation could not be completed in database', {
          executionId,
          attempt,
        })
      }
      return false
    } catch (error) {
      logger.warn('Failed to complete paused execution cancellation in database', {
        executionId,
        attempt,
        error,
      })
      if (attempt < PAUSED_CANCELLATION_DB_ATTEMPTS) {
        await sleep(PAUSED_CANCELLATION_DB_RETRY_MS)
      }
    }
  }
  return false
}

async function ensureCancellationEventPublished(
  executionId: string,
  workflowId: string,
  context: { workspaceId?: string; userId?: string } = {}
): Promise<boolean> {
  try {
    const metaState = await readExecutionMetaState(executionId)
    if (metaState.status === 'found' && metaState.meta.status === 'cancelled') {
      return true
    }
  } catch (error) {
    logger.warn('Failed to read execution state before publishing cancellation', {
      executionId,
      error: toError(error).message,
    })
  }

  const writer = createExecutionEventWriter(executionId, {
    workspaceId: context.workspaceId,
    workflowId,
    userId: context.userId,
  })
  try {
    await writer.writeTerminal(
      {
        type: 'execution:cancelled',
        timestamp: new Date().toISOString(),
        executionId,
        workflowId,
        data: { duration: 0 },
      },
      'cancelled'
    )
    return true
  } catch (error) {
    logger.warn('Failed to publish execution cancellation event', {
      executionId,
      error,
    })
    return false
  } finally {
    await writer.close().catch((error) => {
      logger.warn('Failed to close cancellation event writer', {
        executionId,
        error,
      })
    })
  }
}

export interface CancelWorkflowExecutionInput {
  workflowId: string
  executionId: string
  /** Human attribution resolved by the authorized application use case. */
  attributedUserId: string
  /** Canonical workspace resolved with the workflow run. */
  workspaceId: string
  abortSignal?: AbortSignal
}

export class WorkflowExecutionNotFoundError extends Error {
  constructor() {
    super('Execution not found')
    this.name = 'WorkflowExecutionNotFoundError'
  }
}

function throwCancellationAborted(): never {
  throw new OrchestrationError('conflict', CANCELLATION_ABORTED_MESSAGE)
}

function throwIfCancellationAborted(abortSignal?: AbortSignal): void {
  if (abortSignal?.aborted) throwCancellationAborted()
}

async function rollbackPausedCancellationAfterAbort(args: {
  stage: PausedCancellationStage
  workflowId: string
  executionId: string
  abortSignal?: AbortSignal
}): Promise<boolean> {
  if (!args.abortSignal?.aborted) return false

  if (args.stage.kind === 'active_resume') {
    const rolledBack = await PauseResumeManager.rollbackActiveResumeCancellation(
      args.executionId,
      args.workflowId,
      args.stage.target.resumeEntryId
    )
    if (!rolledBack) {
      logger.warn('Aborted cancellation could not be rolled back; completing cancellation', {
        executionId: args.executionId,
        activeResumeEntryId: args.stage.target.resumeEntryId,
      })
      return false
    }
  } else if (args.stage.kind === 'idle') {
    await PauseResumeManager.clearPausedCancellationIntent(args.executionId, args.workflowId)
  }

  return true
}

function resolveCancellationReason(args: {
  activeResumeSignalFailed: boolean
  pauseReconciliationFailed: boolean
  effectivePausedCancellationPath: boolean
  cancellationEventPublished: boolean
  pausedCancelled: boolean
  stopSummary: ExecutionStopSummary
}): CancelWorkflowExecutionReason {
  if (args.activeResumeSignalFailed) return 'active_resume_signal_failed'
  if (args.pauseReconciliationFailed) return 'paused_database_cancel_failed'
  if (args.effectivePausedCancellationPath && !args.cancellationEventPublished) {
    return 'paused_event_publish_failed'
  }
  if (args.effectivePausedCancellationPath && !args.pausedCancelled) {
    return 'paused_database_cancel_failed'
  }
  if (args.effectivePausedCancellationPath) return 'recorded'
  if (
    args.stopSummary.queueJobsCancelled > 0 &&
    !args.stopSummary.cancellation.durablyRecorded &&
    !args.stopSummary.locallyAborted
  ) {
    return 'queue_cancelled'
  }
  return args.stopSummary.cancellation.reason
}

/**
 * Applies the full queued, active, paused, resumed, and workflow-group
 * cancellation lifecycle to an already-authorized canonical workflow run.
 * Authorization and principal handling belong to `cancelWorkflowRun`; this
 * service accepts only canonical identifiers and returns transport-neutral
 * results or orchestration errors.
 */
export async function cancelWorkflowExecution({
  workflowId,
  executionId,
  attributedUserId,
  workspaceId,
  abortSignal,
}: CancelWorkflowExecutionInput): Promise<CancelWorkflowExecutionResult> {
  try {
    throwIfCancellationAborted(abortSignal)

    const execution = await db
      .select({
        executionDeadlineAt: workflowExecutionLogs.executionDeadlineAt,
        executionOrigin: workflowExecutionOriginSql(),
        status: workflowExecutionLogs.status,
        workspaceId: workflowExecutionLogs.workspaceId,
      })
      .from(workflowExecutionLogs)
      .where(
        and(
          eq(workflowExecutionLogs.executionId, executionId),
          eq(workflowExecutionLogs.workflowId, workflowId),
          eq(workflowExecutionLogs.workspaceId, workspaceId)
        )
      )
      .limit(1)
      .then((rows) => rows[0])

    throwIfCancellationAborted(abortSignal)

    if (!execution) {
      const queueJobsCancelled = await cancelQueuedExecutionJobs(
        workflowId,
        executionId,
        'standalone'
      )
      if (queueJobsCancelled > 0) {
        const locallyAborted = abortLocalExecution(executionId)
        const cancellation = await markExecutionCancelled(executionId)
        await PauseResumeManager.blockQueuedResumesForCancellation(executionId, workflowId).catch(
          (error) => {
            logger.warn('Failed to block queued resumes after queued-run cancellation', {
              executionId,
              error,
            })
          }
        )
        await releaseExecutionSlot(executionId).catch((error) => {
          logger.warn('Failed to release reservation after queued-run cancellation', {
            executionId,
            error,
          })
        })

        return {
          success: true,
          executionId,
          redisAvailable: cancellation.reason !== 'redis_unavailable',
          durablyRecorded: cancellation.durablyRecorded,
          locallyAborted,
          pausedCancelled: false,
          reason: 'queue_cancelled',
        }
      }

      throw new WorkflowExecutionNotFoundError()
    }

    const isWorkflowGroupExecution = execution.executionOrigin === 'workflow_group'

    if (execution.status === 'cancelled') {
      let groupCancellationToPublish: PublishableWorkflowGroupCancellation | null = null
      let groupCancellationCommitted = false
      if (isWorkflowGroupExecution) {
        throwIfCancellationAborted(abortSignal)

        const workflowGroupCancellation = await cancelWorkflowGroupExecution({
          workspaceId: execution.workspaceId,
          workflowId,
          executionId,
        })
        if (workflowGroupCancellation.kind === 'conflict') {
          throw new OrchestrationError(
            'conflict',
            `Workflow group execution cannot be reconciled while ${workflowGroupCancellation.status}`
          )
        }
        if (workflowGroupCancellation.kind === 'not_workflow_group') {
          throw new OrchestrationError(
            'conflict',
            'Workflow group execution is no longer the active table execution'
          )
        }
        if (
          workflowGroupCancellation.kind === 'cancelled' ||
          workflowGroupCancellation.kind === 'already_cancelled'
        ) {
          groupCancellationToPublish = workflowGroupCancellation
          groupCancellationCommitted = true
        }
      }

      const stopSummary = createExecutionStopSummary()
      let pausedCancelled = false
      const pausedCancellationStage = await PauseResumeManager.stagePausedCancellation(
        executionId,
        workflowId
      )
      if (
        !groupCancellationCommitted &&
        (await rollbackPausedCancellationAfterAbort({
          stage: pausedCancellationStage,
          workflowId,
          executionId,
          abortSignal,
        }))
      ) {
        throwCancellationAborted()
      }

      const hasPausedCancellation = isPausedCancellationStage(pausedCancellationStage)
      const requiresCancellationEvent = hasPausedCancellation || isWorkflowGroupExecution
      let cancellationEventPublished = !requiresCancellationEvent
      let activeResumeSignalFailed = false
      let exactStopSatisfied = true
      if (pausedCancellationStage.kind === 'active_resume') {
        exactStopSatisfied = await signalAndRecordActiveResumeStop({
          workflowId,
          executionId,
          executionDeadlineAt: execution.executionDeadlineAt,
          target: pausedCancellationStage.target,
          summary: stopSummary,
        })
        activeResumeSignalFailed = !exactStopSatisfied
      } else if (isWorkflowGroupExecution && !hasPausedCancellation) {
        const retrySignal = await signalExecutionStop({
          workflowId,
          signalExecutionId: executionId,
          executionDeadlineAt: execution.executionDeadlineAt,
        })
        mergeExecutionStopSignal(stopSummary, executionId, retrySignal)
        exactStopSatisfied = retrySignal.accepted
      }

      if (groupCancellationToPublish && exactStopSatisfied) {
        await publishWorkflowGroupCancellationEvent(groupCancellationToPublish, executionId)
      }

      if (requiresCancellationEvent && exactStopSatisfied) {
        cancellationEventPublished = await ensureCancellationEventPublished(
          executionId,
          workflowId,
          {
            workspaceId: execution.workspaceId,
            userId: attributedUserId,
          }
        )
      }
      if (hasPausedCancellation && cancellationEventPublished && exactStopSatisfied) {
        pausedCancelled = await completePausedCancellationWithRetry(executionId, workflowId, {
          logMissing: false,
        })
      }

      if (exactStopSatisfied) {
        await releaseExecutionSlot(executionId).catch((error) => {
          logger.warn('Failed to release reservation while reconciling cancelled execution', {
            executionId,
            error: toError(error).message,
          })
        })
      }

      if (pausedCancelled) {
        await clearStopSignalMarkers(stopSummary)
      }

      const pausedReconciliationSucceeded =
        exactStopSatisfied &&
        (!hasPausedCancellation || (cancellationEventPublished && pausedCancelled))
      return {
        success: pausedReconciliationSucceeded,
        executionId,
        redisAvailable: requiresCancellationEvent ? cancellationEventPublished : true,
        durablyRecorded: false,
        locallyAborted: stopSummary.locallyAborted,
        pausedCancelled,
        reason: activeResumeSignalFailed
          ? 'active_resume_signal_failed'
          : !exactStopSatisfied
            ? stopSummary.cancellation.reason
            : hasPausedCancellation && !cancellationEventPublished
              ? 'paused_event_publish_failed'
              : hasPausedCancellation && !pausedCancelled
                ? 'paused_database_cancel_failed'
                : 'already_cancelled',
      }
    }

    if (execution.status !== 'running' && execution.status !== 'pending') {
      if (!isWorkflowGroupExecution && isWorkflowRunAlreadyTerminalStatus(execution.status)) {
        throw new WorkflowRunAlreadyTerminalError({
          executionId,
          executionStatus: execution.status,
          redisAvailable: true,
          locallyAborted: false,
        })
      }
      throw new OrchestrationError(
        'conflict',
        `Execution cannot be cancelled while ${execution.status}`
      )
    }

    logger.info('Cancel execution requested', { workflowId, executionId, attributedUserId })

    const stopSummary = createExecutionStopSummary()
    let pausedCancelled = false
    let pausedCancellationStage = await PauseResumeManager.stagePausedCancellation(
      executionId,
      workflowId
    )
    if (
      await rollbackPausedCancellationAfterAbort({
        stage: pausedCancellationStage,
        workflowId,
        executionId,
        abortSignal,
      })
    ) {
      throwCancellationAborted()
    }

    let effectivePausedCancellationPath = isPausedCancellationStage(pausedCancellationStage)
    let activeResumeTarget =
      pausedCancellationStage.kind === 'active_resume' ? pausedCancellationStage.target : null
    let activeResumeEntryId = activeResumeTarget?.resumeEntryId ?? null
    let activeResumeSignalAccepted = false

    if (activeResumeTarget && !isWorkflowGroupExecution) {
      activeResumeSignalAccepted = await signalAndRecordActiveResumeStop({
        workflowId,
        executionId,
        executionDeadlineAt: execution.executionDeadlineAt,
        target: activeResumeTarget,
        summary: stopSummary,
      })

      if (!activeResumeSignalAccepted) {
        const failedResumeEntryId = activeResumeTarget.resumeEntryId
        await PauseResumeManager.rollbackActiveResumeCancellation(
          executionId,
          workflowId,
          failedResumeEntryId
        ).catch((error) => {
          logger.warn('Failed to roll back active resume cancellation intent', {
            executionId,
            activeResumeEntryId: failedResumeEntryId,
            error: toError(error).message,
          })
        })
        await clearStopSignalMarkers(stopSummary)
        return {
          success: false,
          executionId,
          redisAvailable: stopSummary.cancellation.reason !== 'redis_unavailable',
          durablyRecorded: stopSummary.cancellation.durablyRecorded,
          locallyAborted: stopSummary.locallyAborted,
          pausedCancelled: false,
          reason: 'active_resume_signal_failed',
        }
      }
    } else if (!effectivePausedCancellationPath && !isWorkflowGroupExecution) {
      const signal = await signalExecutionStop({
        workflowId,
        signalExecutionId: executionId,
        executionDeadlineAt: execution.executionDeadlineAt,
        queueScope: 'standalone',
      })
      mergeExecutionStopSignal(stopSummary, executionId, signal)

      if (!signal.accepted) {
        pausedCancellationStage = await PauseResumeManager.stagePausedCancellation(
          executionId,
          workflowId
        )
        const postLateStageAbort = await rollbackPausedCancellationAfterAbort({
          stage: pausedCancellationStage,
          workflowId,
          executionId,
          abortSignal,
        })
        if (postLateStageAbort) {
          await clearStopSignalMarkers(stopSummary)
          throwCancellationAborted()
        }

        effectivePausedCancellationPath = isPausedCancellationStage(pausedCancellationStage)
        activeResumeTarget =
          pausedCancellationStage.kind === 'active_resume' ? pausedCancellationStage.target : null
        activeResumeEntryId = activeResumeTarget?.resumeEntryId ?? null

        if (activeResumeTarget) {
          activeResumeSignalAccepted = await signalAndRecordActiveResumeStop({
            workflowId,
            executionId,
            executionDeadlineAt: execution.executionDeadlineAt,
            target: activeResumeTarget,
            summary: stopSummary,
          })
          if (!activeResumeSignalAccepted) {
            const failedResumeEntryId = activeResumeTarget.resumeEntryId
            await PauseResumeManager.rollbackActiveResumeCancellation(
              executionId,
              workflowId,
              failedResumeEntryId
            ).catch((error) => {
              logger.warn('Failed to roll back late active resume cancellation intent', {
                executionId,
                activeResumeEntryId: failedResumeEntryId,
                error: toError(error).message,
              })
            })
            await clearStopSignalMarkers(stopSummary)
            return {
              success: false,
              executionId,
              redisAvailable: stopSummary.cancellation.reason !== 'redis_unavailable',
              durablyRecorded: stopSummary.cancellation.durablyRecorded,
              locallyAborted: stopSummary.locallyAborted,
              pausedCancelled: false,
              reason: 'active_resume_signal_failed',
            }
          }
        } else if (!effectivePausedCancellationPath) {
          return {
            success: false,
            executionId,
            redisAvailable: stopSummary.cancellation.reason !== 'redis_unavailable',
            durablyRecorded: stopSummary.cancellation.durablyRecorded,
            locallyAborted: stopSummary.locallyAborted,
            pausedCancelled: false,
            reason: stopSummary.cancellation.reason,
          }
        }
      }
    }

    let terminalCancellationClaimed = false
    let competingTerminalStatus: string | null = null
    let workflowGroupNoLongerActive = false
    let groupCancellationToPublish: PublishableWorkflowGroupCancellation | null = null
    try {
      if (isWorkflowGroupExecution) {
        const workflowGroupCancellation = await cancelWorkflowGroupExecution({
          workspaceId: execution.workspaceId,
          workflowId,
          executionId,
        })
        if (workflowGroupCancellation.kind === 'conflict') {
          competingTerminalStatus = workflowGroupCancellation.status
        } else if (workflowGroupCancellation.kind === 'not_workflow_group') {
          workflowGroupNoLongerActive = true
        } else {
          terminalCancellationClaimed = true
          if (
            workflowGroupCancellation.kind === 'cancelled' ||
            workflowGroupCancellation.kind === 'already_cancelled'
          ) {
            groupCancellationToPublish = workflowGroupCancellation
          }
        }
      } else {
        const claim = await claimExecutionLogCancellation({
          executionId,
          workflowId,
          workspaceId: execution.workspaceId,
        })
        if (claim.kind === 'cancelled') {
          terminalCancellationClaimed = true
        } else {
          competingTerminalStatus = claim.kind === 'conflict' ? claim.status : 'no_longer_active'
        }
      }
    } catch (dbError) {
      logger.warn('Failed to finalize cancelled execution directly', {
        executionId,
        error: toError(dbError).message,
      })
    }

    if (workflowGroupNoLongerActive) {
      await clearStopSignalMarkers(stopSummary)
      if (activeResumeEntryId) {
        await PauseResumeManager.rollbackActiveResumeCancellation(
          executionId,
          workflowId,
          activeResumeEntryId
        ).catch((error) => {
          logger.warn('Failed to roll back active resume after group target disappeared', {
            executionId,
            activeResumeEntryId,
            error: toError(error).message,
          })
        })
      } else if (effectivePausedCancellationPath) {
        await PauseResumeManager.clearPausedCancellationIntent(executionId, workflowId).catch(
          (error) => {
            logger.warn('Failed to clear cancellation intent after group target disappeared', {
              executionId,
              error: toError(error).message,
            })
          }
        )
      }
      throw new OrchestrationError(
        'conflict',
        'Workflow group execution is no longer the active table execution'
      )
    }

    if (competingTerminalStatus) {
      await clearStopSignalMarkers(stopSummary)
      if (activeResumeEntryId) {
        await PauseResumeManager.rollbackActiveResumeCancellation(
          executionId,
          workflowId,
          activeResumeEntryId
        ).catch((error) => {
          logger.warn('Failed to roll back active resume after terminal race', {
            executionId,
            activeResumeEntryId,
            error: toError(error).message,
          })
        })
      } else if (effectivePausedCancellationPath) {
        await PauseResumeManager.clearPausedCancellationIntent(executionId, workflowId).catch(
          (error) => {
            logger.warn('Failed to clear cancellation intent after terminal race', {
              executionId,
              error: toError(error).message,
            })
          }
        )
      }
      if (
        !isWorkflowGroupExecution &&
        isWorkflowRunAlreadyTerminalStatus(competingTerminalStatus)
      ) {
        throw new WorkflowRunAlreadyTerminalError({
          executionId,
          executionStatus: competingTerminalStatus,
          redisAvailable: stopSummary.cancellation.reason !== 'redis_unavailable',
          locallyAborted: stopSummary.locallyAborted,
        })
      }
      throw new OrchestrationError(
        'conflict',
        isWorkflowGroupExecution
          ? `Workflow group execution cannot be cancelled while ${competingTerminalStatus}`
          : `Execution cannot be cancelled while ${competingTerminalStatus}`
      )
    }

    if (!terminalCancellationClaimed) {
      if (effectivePausedCancellationPath && !stopSummary.accepted) {
        if (activeResumeEntryId) {
          await PauseResumeManager.rollbackActiveResumeCancellation(
            executionId,
            workflowId,
            activeResumeEntryId
          )
        } else {
          await PauseResumeManager.clearPausedCancellationIntent(executionId, workflowId)
        }
      }
      return {
        success: false,
        executionId,
        redisAvailable: stopSummary.cancellation.reason !== 'redis_unavailable',
        durablyRecorded: stopSummary.cancellation.durablyRecorded,
        locallyAborted: stopSummary.locallyAborted,
        pausedCancelled: false,
        reason: 'cancellation_not_finalized',
      }
    }

    let pauseReconciliationFailed = false
    let activeResumeSignalFailed = false
    if (isWorkflowGroupExecution) {
      if (activeResumeTarget) {
        activeResumeSignalAccepted = await signalAndRecordActiveResumeStop({
          workflowId,
          executionId,
          executionDeadlineAt: execution.executionDeadlineAt,
          target: activeResumeTarget,
          summary: stopSummary,
        })
        activeResumeSignalFailed = !activeResumeSignalAccepted
      } else if (!effectivePausedCancellationPath) {
        const groupSignal = await signalExecutionStop({
          workflowId,
          signalExecutionId: executionId,
          executionDeadlineAt: execution.executionDeadlineAt,
        })
        mergeExecutionStopSignal(stopSummary, executionId, groupSignal)
      }
    }

    try {
      const postClaimPausedCancellationStage = await PauseResumeManager.stagePausedCancellation(
        executionId,
        workflowId
      )
      if (isPausedCancellationStage(postClaimPausedCancellationStage)) {
        effectivePausedCancellationPath = true
        if (postClaimPausedCancellationStage.kind === 'active_resume') {
          const currentActiveResume = postClaimPausedCancellationStage.target
          const alreadyAttemptedCurrentResume =
            currentActiveResume.resumeEntryId === activeResumeEntryId &&
            stopSummary.signalledExecutionIds.has(currentActiveResume.resumeExecutionId)
          if (!alreadyAttemptedCurrentResume) {
            activeResumeSignalAccepted = await signalAndRecordActiveResumeStop({
              workflowId,
              executionId,
              executionDeadlineAt: execution.executionDeadlineAt,
              target: currentActiveResume,
              summary: stopSummary,
            })
          }
          activeResumeSignalFailed = !activeResumeSignalAccepted
        } else {
          activeResumeSignalFailed = false
        }
      }
    } catch (error) {
      pauseReconciliationFailed = true
      effectivePausedCancellationPath = true
      logger.warn('Failed to recheck paused execution after terminal cancellation claim', {
        executionId,
        error: toError(error).message,
      })
    }

    const executionStopSatisfied = effectivePausedCancellationPath
      ? !activeResumeSignalFailed
      : stopSummary.accepted
    if (groupCancellationToPublish && executionStopSatisfied && !pauseReconciliationFailed) {
      await publishWorkflowGroupCancellationEvent(groupCancellationToPublish, executionId)
    }
    let cancellationEventPublished = false
    if (executionStopSatisfied && !pauseReconciliationFailed) {
      cancellationEventPublished = await ensureCancellationEventPublished(executionId, workflowId, {
        workspaceId: execution.workspaceId,
        userId: attributedUserId,
      })
    }

    if (effectivePausedCancellationPath) {
      if (cancellationEventPublished && !pauseReconciliationFailed && !activeResumeSignalFailed) {
        pausedCancelled = await completePausedCancellationWithRetry(executionId, workflowId)
      }
    } else if (executionStopSatisfied) {
      await releaseExecutionSlot(executionId).catch((error) => {
        logger.warn('Failed to release reservation after execution cancellation', {
          executionId,
          error: toError(error).message,
        })
      })
    }

    const success = effectivePausedCancellationPath
      ? pausedCancelled &&
        cancellationEventPublished &&
        !pauseReconciliationFailed &&
        !activeResumeSignalFailed
      : executionStopSatisfied

    if (effectivePausedCancellationPath && pausedCancelled && cancellationEventPublished) {
      await clearStopSignalMarkers(stopSummary)
    }

    const durablyRecorded = effectivePausedCancellationPath
      ? true
      : stopSummary.cancellation.durablyRecorded
    const reason = resolveCancellationReason({
      activeResumeSignalFailed,
      pauseReconciliationFailed,
      effectivePausedCancellationPath,
      cancellationEventPublished,
      pausedCancelled,
      stopSummary,
    })

    return {
      success,
      executionId,
      redisAvailable:
        effectivePausedCancellationPath || pausedCancelled
          ? cancellationEventPublished
          : stopSummary.cancellation.reason !== 'redis_unavailable',
      durablyRecorded,
      locallyAborted: stopSummary.locallyAborted,
      pausedCancelled,
      reason,
    }
  } catch (error) {
    const normalizedError = toError(error)
    logger.error('Failed to cancel execution', {
      workflowId,
      executionId,
      error: normalizedError.message,
    })
    throw error
  }
}
