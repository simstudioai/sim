import { db } from '@sim/db'
import { workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { sleep } from '@sim/utils/helpers'
import { and, eq } from 'drizzle-orm'
import { releaseExecutionSlot } from '@/lib/billing/calculations/usage-reservation'
import { getJobQueue } from '@/lib/core/async-jobs'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type ExecutionCancellationRecordResult,
  markExecutionCancelled,
} from '@/lib/execution/cancellation'
import { createExecutionEventWriter, readExecutionMetaState } from '@/lib/execution/event-buffer'
import { abortManualExecution } from '@/lib/execution/manual-cancellation'
import { captureServerEvent } from '@/lib/posthog/server'
import {
  cancelWorkflowGroupExecution,
  type PublishableWorkflowGroupCancellation,
  publishWorkflowGroupCancellationEvent,
} from '@/lib/table/workflow-group-cancellation'
import { WORKFLOW_EXECUTION_JOB_ID_PREFIX } from '@/lib/workflows/executor/execution-job-ids'
import { resolveWorkflowExecutionOwnership } from '@/lib/workflows/executor/execution-queries'
import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'

const logger = createLogger('CancelWorkflowExecution')
const PAUSED_CANCELLATION_DB_ATTEMPTS = 3
const PAUSED_CANCELLATION_DB_RETRY_MS = 200

async function cancelActiveWorkflowJob(executionId: string): Promise<boolean> {
  try {
    const queue = await getJobQueue()
    const job = await queue.getJob(`${WORKFLOW_EXECUTION_JOB_ID_PREFIX}${executionId}`)
    if (!job || (job.status !== 'pending' && job.status !== 'processing')) return false
    await queue.cancelJob(job.id)
    logger.info('Cancelled active workflow queue job', { executionId, jobId: job.id })
    return true
  } catch (error) {
    logger.warn('Failed to cancel active workflow queue job', { executionId, error })
    return false
  }
}

/**
 * Cancellation outcome vocabulary produced by this service, and so the whole
 * vocabulary the public v2 endpoint can return. `recorded`/`redis_unavailable`/
 * `redis_write_failed` come from the Redis record step; the two `paused_*`
 * values from the paused-HITL path. The internal cancel route resolves further
 * outcomes on top of these — see `internalCancelWorkflowExecutionReasonSchema`
 * in `lib/api/contracts/workflows`.
 */
export type CancelWorkflowExecutionReason =
  | 'recorded'
  | 'redis_unavailable'
  | 'redis_write_failed'
  | 'paused_event_publish_failed'
  | 'paused_database_cancel_failed'

export interface CancelWorkflowExecutionResult {
  success: boolean
  executionId: string
  redisAvailable: boolean
  durablyRecorded: boolean
  locallyAborted: boolean
  pausedCancelled: boolean
  reason?: CancelWorkflowExecutionReason
}

async function completePausedCancellationWithRetry(
  executionId: string,
  workflowId: string
): Promise<boolean> {
  for (let attempt = 1; attempt <= PAUSED_CANCELLATION_DB_ATTEMPTS; attempt++) {
    try {
      const cancelled = await PauseResumeManager.completePausedCancellation(executionId, workflowId)
      if (cancelled) {
        logger.info('Paused execution cancelled in database', { executionId, attempt })
        return true
      }
      logger.warn('Paused execution cancellation could not be completed in database', {
        executionId,
        attempt,
      })
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

async function ensurePausedCancellationEventPublished(
  executionId: string,
  workflowId: string,
  context: { workspaceId?: string; userId?: string } = {}
): Promise<boolean> {
  const metaState = await readExecutionMetaState(executionId)
  if (metaState.status === 'found' && metaState.meta.status === 'cancelled') {
    return true
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
    logger.warn('Failed to publish paused execution cancellation event', {
      executionId,
      error,
    })
    return false
  } finally {
    await writer.close().catch((error) => {
      logger.warn('Failed to close paused cancellation event writer', {
        executionId,
        error,
      })
    })
  }
}

export interface CancelWorkflowExecutionInput {
  executionId: string
  workflowId: string
  /** Actor for the analytics event. */
  userId: string
  /** Workflow's workspace; feeds the event writer + analytics grouping. */
  workspaceId?: string
  /** Legacy callers emit product analytics here; migrated adapters emit it after success. */
  captureAnalytics?: boolean
}

export class WorkflowExecutionNotFoundError extends Error {
  constructor() {
    super('Execution not found')
    this.name = 'WorkflowExecutionNotFoundError'
  }
}

/**
 * Cancels a workflow execution across the Redis abort record, the in-process
 * aborter, the paused-HITL machinery, the workflow-group table cell sidecar, and
 * the plan concurrency reservation. The interleaving is order-sensitive. Auth is
 * the caller's responsibility; this throws on unexpected infrastructure errors.
 *
 * A workflow-group run whose cell sidecar refuses the claim throws
 * `OrchestrationError('conflict')` rather than returning a success-shaped result:
 * the cancel did not fully happen, and the internal route already answers 409 for
 * exactly these two outcomes.
 */
export async function cancelWorkflowExecution(
  input: CancelWorkflowExecutionInput
): Promise<CancelWorkflowExecutionResult> {
  const { executionId, workflowId, userId, workspaceId } = input

  const { belongsToWorkflow, workflowGroupWorkspaceId } = await resolveWorkflowExecutionOwnership(
    executionId,
    workflowId
  )
  if (!belongsToWorkflow) throw new WorkflowExecutionNotFoundError()

  let pausedCancellationStarted = false
  let pausedCancelled = false
  try {
    pausedCancellationStarted = await PauseResumeManager.beginPausedCancellation(
      executionId,
      workflowId
    )
  } catch (error) {
    logger.warn('Failed to begin paused execution cancellation in database', {
      executionId,
      error,
    })
  }
  const pendingPausedCancellation = pausedCancellationStarted
    ? null
    : await PauseResumeManager.getPausedCancellationStatus(executionId, workflowId)
  const isPausedCancellationPath = pausedCancellationStarted || pendingPausedCancellation !== null

  const cancellation: ExecutionCancellationRecordResult = isPausedCancellationPath
    ? { durablyRecorded: false, reason: 'redis_unavailable' }
    : await markExecutionCancelled(executionId)
  const locallyAborted = isPausedCancellationPath ? false : abortManualExecution(executionId)
  const queuedJobCancelled = isPausedCancellationPath
    ? false
    : await cancelActiveWorkflowJob(executionId)

  if (pausedCancellationStarted) {
    logger.info('Paused execution cancellation reserved in database', { executionId })
  } else if (cancellation.durablyRecorded) {
    logger.info('Execution marked as cancelled in Redis', { executionId })
  } else if (queuedJobCancelled) {
    logger.info('Execution cancelled in workflow queue', { executionId })
  } else if (locallyAborted) {
    logger.info('Execution cancelled via local in-process fallback', { executionId })
  } else if (!pausedCancellationStarted) {
    logger.warn('Execution cancellation was not durably recorded', {
      executionId,
      reason: cancellation.reason,
    })
  }

  if (
    !isPausedCancellationPath &&
    (cancellation.durablyRecorded || queuedJobCancelled || locallyAborted)
  ) {
    await PauseResumeManager.blockQueuedResumesForCancellation(executionId, workflowId).catch(
      (error) => {
        logger.warn('Failed to block queued paused resumes after cancellation', {
          executionId,
          error,
        })
      }
    )
  } else if (!isPausedCancellationPath) {
    await PauseResumeManager.clearPausedCancellationIntent(executionId, workflowId).catch(
      (error) => {
        logger.warn('Failed to clear paused cancellation intent after unsuccessful cancellation', {
          executionId,
          error,
        })
      }
    )
  }

  let pausedCancellationPublished = false
  let pausedCancellationPublishFailed = false
  if (pausedCancellationStarted) {
    pausedCancellationPublished = await ensurePausedCancellationEventPublished(
      executionId,
      workflowId,
      { workspaceId, userId }
    )
    pausedCancellationPublishFailed = !pausedCancellationPublished
    if (pausedCancellationPublished) {
      pausedCancelled = await completePausedCancellationWithRetry(executionId, workflowId)
    }
  } else {
    if (pendingPausedCancellation === 'cancelled') {
      pausedCancellationPublished = await ensurePausedCancellationEventPublished(
        executionId,
        workflowId,
        { workspaceId, userId }
      )
      pausedCancellationPublishFailed = !pausedCancellationPublished
      pausedCancelled = pausedCancellationPublished
    } else if (pendingPausedCancellation === 'cancelling') {
      pausedCancellationPublished = await ensurePausedCancellationEventPublished(
        executionId,
        workflowId,
        { workspaceId, userId }
      )
      pausedCancellationPublishFailed = !pausedCancellationPublished
      if (pausedCancellationPublished) {
        pausedCancelled = await completePausedCancellationWithRetry(executionId, workflowId)
      }
    }
  }

  if (
    pausedCancellationPublishFailed &&
    (pausedCancellationStarted || pendingPausedCancellation === 'cancelling')
  ) {
    await PauseResumeManager.clearPausedCancellationIntent(executionId, workflowId).catch(
      (error) => {
        logger.warn('Failed to clear paused cancellation intent after publish failure', {
          executionId,
          error,
        })
      }
    )
  }

  const success =
    (isPausedCancellationPath
      ? pausedCancelled && pausedCancellationPublished
      : cancellation.durablyRecorded || queuedJobCancelled) || locallyAborted

  /**
   * Frees the plan concurrency reservation once the stop-the-work effects above
   * have actually taken. The paused path keeps its reservation because a paused
   * run never held an in-flight slot to give back, and an unsuccessful ordinary
   * cancel keeps it because the run may still be executing.
   */
  const releaseSlotForStoppedExecution = async (): Promise<void> => {
    if (!success || isPausedCancellationPath) return
    await releaseExecutionSlot(executionId).catch((error) => {
      logger.warn('Failed to release reservation after execution cancellation', {
        executionId,
        error,
      })
    })
  }

  /**
   * The sidecar transition can fail outright — a lost claim, a serialization
   * conflict, a connection blip. The stop-the-work effects above have already
   * fired, so the run is going down regardless and the reservation must not be
   * stranded; but the cell is left in an unknown state, so the failure is
   * re-thrown rather than swallowed into a success-shaped result.
   */
  let groupCancellation: Awaited<ReturnType<typeof cancelWorkflowGroupExecution>> | null = null
  if (workflowGroupWorkspaceId) {
    try {
      groupCancellation = await cancelWorkflowGroupExecution({
        workspaceId: workflowGroupWorkspaceId,
        workflowId,
        executionId,
      })
    } catch (error) {
      logger.error('Workflow group execution cancellation failed unexpectedly', {
        executionId,
        error,
      })
      await releaseSlotForStoppedExecution()
      throw error
    }
  }

  /**
   * Both refusals mean the cell claim was lost, never that the run is still
   * going: the sidecar conflicts only on a terminal workflow log or a terminal
   * cell, and `not_workflow_group` means the log is not a group run at all.
   * Every refusal is a terminal-or-absent state that carries no evidence of
   * liveness, so nothing is left running to hold the reservation and it is
   * released before the 409 rather than left to expire. (The Redis abort record
   * is reversible — see `clearExecutionCancellation` — but a refusal gives no
   * reason to reverse it.)
   */
  if (groupCancellation?.kind === 'conflict') {
    logger.warn('Workflow group execution could not be cancelled', {
      executionId,
      status: groupCancellation.status,
    })
    await releaseSlotForStoppedExecution()
    throw new OrchestrationError(
      'conflict',
      `Workflow group execution cannot be cancelled while ${groupCancellation.status}`
    )
  }
  if (groupCancellation?.kind === 'not_workflow_group') {
    logger.warn('Workflow group execution is no longer the active table execution', { executionId })
    await releaseSlotForStoppedExecution()
    throw new OrchestrationError(
      'conflict',
      'Workflow group execution is no longer the active table execution'
    )
  }

  const groupCancellationToPublish: PublishableWorkflowGroupCancellation | null =
    groupCancellation?.kind === 'cancelled' || groupCancellation?.kind === 'already_cancelled'
      ? groupCancellation
      : null

  if (
    groupCancellation === null &&
    (cancellation.durablyRecorded || queuedJobCancelled || locallyAborted) &&
    !pausedCancelled
  ) {
    try {
      await db
        .update(workflowExecutionLogs)
        .set({ status: 'cancelled', endedAt: new Date() })
        .where(
          and(
            eq(workflowExecutionLogs.executionId, executionId),
            eq(workflowExecutionLogs.status, 'running')
          )
        )
    } catch (dbError) {
      logger.warn('Failed to update execution log status directly', {
        executionId,
        error: dbError,
      })
    }
  }

  if (groupCancellationToPublish && success) {
    await publishWorkflowGroupCancellationEvent(groupCancellationToPublish, executionId)
  }

  await releaseSlotForStoppedExecution()

  if (success && input.captureAnalytics !== false) {
    captureServerEvent(
      userId,
      'workflow_execution_cancelled',
      { workflow_id: workflowId, workspace_id: workspaceId ?? '' },
      workspaceId ? { groups: { workspace: workspaceId } } : undefined
    )
  }

  const durablyRecorded = isPausedCancellationPath
    ? pausedCancellationPublished
    : pausedCancelled || cancellation.durablyRecorded || queuedJobCancelled
  const reason: CancelWorkflowExecutionReason = pausedCancellationPublishFailed
    ? 'paused_event_publish_failed'
    : !pausedCancelled && isPausedCancellationPath
      ? 'paused_database_cancel_failed'
      : pausedCancelled && !pausedCancellationPublished
        ? 'paused_event_publish_failed'
        : pausedCancelled || isPausedCancellationPath
          ? 'recorded'
          : queuedJobCancelled
            ? 'recorded'
            : cancellation.reason

  return {
    success,
    executionId,
    redisAvailable:
      isPausedCancellationPath || pausedCancelled
        ? pausedCancellationPublished
        : cancellation.reason !== 'redis_unavailable',
    durablyRecorded,
    locallyAborted,
    pausedCancelled,
    reason,
  }
}
