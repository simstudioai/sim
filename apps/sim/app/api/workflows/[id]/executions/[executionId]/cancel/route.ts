import { db } from '@sim/db'
import { workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { authorizeWorkflowByWorkspacePermission } from '@sim/platform-authz/workflow'
import { toError } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { and, eq, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { cancelWorkflowExecutionContract } from '@/lib/api/contracts/workflows'
import { parseRequest } from '@/lib/api/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { releaseExecutionSlot } from '@/lib/billing/calculations/usage-reservation'
import { getJobQueue } from '@/lib/core/async-jobs'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  clearExecutionCancellation,
  type ExecutionCancellationRecordResult,
  markExecutionCancelled,
} from '@/lib/execution/cancellation'
import { createExecutionEventWriter, readExecutionMetaState } from '@/lib/execution/event-buffer'
import { abortManualExecution } from '@/lib/execution/manual-cancellation'
import { captureServerEvent } from '@/lib/posthog/server'
import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'

const logger = createLogger('CancelExecutionAPI')
const PAUSED_CANCELLATION_DB_ATTEMPTS = 3
const PAUSED_CANCELLATION_DB_RETRY_MS = 200

async function cancelQueuedExecutionJobs(workflowId: string, executionId: string): Promise<number> {
  try {
    const queue = await getJobQueue()
    return await queue.cancelByExecution({ workflowId, executionId })
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

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string; executionId: string }> }) => {
    const auth = await checkHybridAuth(req, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(cancelWorkflowExecutionContract, req, context)
    if (!parsed.success) return parsed.response
    const { id: workflowId, executionId } = parsed.data.params

    try {
      const workflowAuthorization = await authorizeWorkflowByWorkspacePermission({
        workflowId,
        userId: auth.userId,
        action: 'write',
      })
      if (!workflowAuthorization.allowed) {
        return NextResponse.json(
          { error: workflowAuthorization.message || 'Access denied' },
          { status: workflowAuthorization.status }
        )
      }

      if (
        auth.apiKeyType === 'workspace' &&
        workflowAuthorization.workflow?.workspaceId !== auth.workspaceId
      ) {
        return NextResponse.json(
          { error: 'API key is not authorized for this workspace' },
          { status: 403 }
        )
      }

      const execution = await db
        .select({
          executionDeadlineAt: workflowExecutionLogs.executionDeadlineAt,
          status: workflowExecutionLogs.status,
          workspaceId: workflowExecutionLogs.workspaceId,
        })
        .from(workflowExecutionLogs)
        .where(
          and(
            eq(workflowExecutionLogs.executionId, executionId),
            eq(workflowExecutionLogs.workflowId, workflowId)
          )
        )
        .limit(1)
        .then((rows) => rows[0])

      if (!execution) {
        const locallyAborted = abortLocalExecution(executionId)
        const queueJobsCancelled = await cancelQueuedExecutionJobs(workflowId, executionId)
        if (locallyAborted || queueJobsCancelled > 0) {
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

          const workspaceId = workflowAuthorization.workflow?.workspaceId
          captureServerEvent(
            auth.userId,
            'workflow_execution_cancelled',
            { workflow_id: workflowId, workspace_id: workspaceId ?? '' },
            workspaceId ? { groups: { workspace: workspaceId } } : undefined
          )

          return NextResponse.json({
            success: true,
            executionId,
            redisAvailable: cancellation.reason !== 'redis_unavailable',
            durablyRecorded: cancellation.durablyRecorded,
            locallyAborted,
            pausedCancelled: false,
            reason: queueJobsCancelled > 0 ? 'queue_cancelled' : 'locally_aborted',
          })
        }

        return NextResponse.json({ error: 'Execution not found' }, { status: 404 })
      }

      const authorizedWorkspaceId = workflowAuthorization.workflow?.workspaceId
      if (authorizedWorkspaceId && execution.workspaceId !== authorizedWorkspaceId) {
        return NextResponse.json({ error: 'Execution not found' }, { status: 404 })
      }

      if (execution.status === 'cancelled') {
        return NextResponse.json({
          success: true,
          executionId,
          redisAvailable: true,
          durablyRecorded: false,
          locallyAborted: false,
          pausedCancelled: false,
          reason: 'already_cancelled',
        })
      }

      if (execution.status !== 'running' && execution.status !== 'pending') {
        return NextResponse.json(
          { error: `Execution cannot be cancelled while ${execution.status}` },
          { status: 409 }
        )
      }

      logger.info('Cancel execution requested', { workflowId, executionId, userId: auth.userId })

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
      const isPausedCancellationPath =
        pausedCancellationStarted || pendingPausedCancellation !== null

      const cancellation: ExecutionCancellationRecordResult = isPausedCancellationPath
        ? { durablyRecorded: false, reason: 'redis_unavailable' }
        : await markExecutionCancelled(executionId, {
            executionDeadlineAt: execution.executionDeadlineAt,
          })
      const locallyAborted = isPausedCancellationPath ? false : abortLocalExecution(executionId)
      const queueJobsCancelled = await cancelQueuedExecutionJobs(workflowId, executionId)
      const queueCancelled = queueJobsCancelled > 0

      if (pausedCancellationStarted) {
        logger.info('Paused execution cancellation reserved in database', { executionId })
      } else if (cancellation.durablyRecorded) {
        logger.info('Execution marked as cancelled in Redis', { executionId })
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
        (cancellation.durablyRecorded || locallyAborted || queueCancelled)
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
            logger.warn(
              'Failed to clear paused cancellation intent after unsuccessful cancellation',
              {
                executionId,
                error,
              }
            )
          }
        )
      }

      let pausedCancellationPublished = false
      let pausedCancellationPublishFailed = false
      if (pausedCancellationStarted) {
        pausedCancellationPublished = await ensureCancellationEventPublished(
          executionId,
          workflowId,
          {
            workspaceId: execution.workspaceId,
            userId: auth.userId,
          }
        )
        pausedCancellationPublishFailed = !pausedCancellationPublished
        if (pausedCancellationPublished) {
          pausedCancelled = await completePausedCancellationWithRetry(executionId, workflowId)
        }
      } else {
        if (pendingPausedCancellation === 'cancelled') {
          pausedCancellationPublished = await ensureCancellationEventPublished(
            executionId,
            workflowId,
            {
              workspaceId: execution.workspaceId,
              userId: auth.userId,
            }
          )
          pausedCancellationPublishFailed = !pausedCancellationPublished
          pausedCancelled = pausedCancellationPublished
        } else if (pendingPausedCancellation === 'cancelling') {
          pausedCancellationPublished = await ensureCancellationEventPublished(
            executionId,
            workflowId,
            {
              workspaceId: execution.workspaceId,
              userId: auth.userId,
            }
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

      const liveCancellationAccepted =
        cancellation.durablyRecorded || locallyAborted || queueCancelled
      let liveCancellationFinalized = false
      let competingTerminalStatus: string | null = null
      if (liveCancellationAccepted && !isPausedCancellationPath) {
        try {
          const [cancelledExecution] = await db
            .update(workflowExecutionLogs)
            .set({ status: 'cancelled', endedAt: new Date(), executionDeadlineAt: null })
            .where(
              and(
                eq(workflowExecutionLogs.executionId, executionId),
                eq(workflowExecutionLogs.workflowId, workflowId),
                inArray(workflowExecutionLogs.status, ['running', 'pending'])
              )
            )
            .returning({ status: workflowExecutionLogs.status })

          liveCancellationFinalized = cancelledExecution?.status === 'cancelled'
          if (!liveCancellationFinalized) {
            const currentExecution = await db
              .select({ status: workflowExecutionLogs.status })
              .from(workflowExecutionLogs)
              .where(
                and(
                  eq(workflowExecutionLogs.executionId, executionId),
                  eq(workflowExecutionLogs.workflowId, workflowId)
                )
              )
              .limit(1)
              .then((rows) => rows[0])
            liveCancellationFinalized = currentExecution?.status === 'cancelled'
            if (
              currentExecution &&
              currentExecution.status !== 'running' &&
              currentExecution.status !== 'pending' &&
              currentExecution.status !== 'cancelled'
            ) {
              competingTerminalStatus = currentExecution.status
            }
          }

          if (liveCancellationFinalized) {
            await ensureCancellationEventPublished(executionId, workflowId, {
              workspaceId: execution.workspaceId,
              userId: auth.userId,
            })
            await releaseExecutionSlot(executionId)
          }
        } catch (dbError) {
          logger.warn('Failed to finalize cancelled execution directly', {
            executionId,
            error: dbError,
          })
        }
      }

      const success =
        !competingTerminalStatus &&
        (isPausedCancellationPath
          ? pausedCancelled && pausedCancellationPublished
          : liveCancellationFinalized)

      if (
        (isPausedCancellationPath && pausedCancelled && pausedCancellationPublished) ||
        competingTerminalStatus
      ) {
        await clearExecutionCancellation(executionId)
      }

      if (competingTerminalStatus) {
        await PauseResumeManager.clearPausedCancellationIntent(executionId, workflowId).catch(
          (error) => {
            logger.warn('Failed to clear cancellation intent after terminal race', {
              executionId,
              error,
            })
          }
        )
        return NextResponse.json(
          { error: `Execution cannot be cancelled while ${competingTerminalStatus}` },
          { status: 409 }
        )
      }

      if (success) {
        const workspaceId = execution.workspaceId
        captureServerEvent(
          auth.userId,
          'workflow_execution_cancelled',
          { workflow_id: workflowId, workspace_id: workspaceId ?? '' },
          workspaceId ? { groups: { workspace: workspaceId } } : undefined
        )
      }

      const durablyRecorded = isPausedCancellationPath
        ? pausedCancellationPublished
        : pausedCancelled || cancellation.durablyRecorded
      const reason = pausedCancellationPublishFailed
        ? 'paused_event_publish_failed'
        : !pausedCancelled && isPausedCancellationPath
          ? 'paused_database_cancel_failed'
          : pausedCancelled && !pausedCancellationPublished
            ? 'paused_event_publish_failed'
            : pausedCancelled || isPausedCancellationPath
              ? 'recorded'
              : queueCancelled
                ? liveCancellationFinalized
                  ? 'queue_cancelled'
                  : 'cancellation_not_finalized'
                : liveCancellationAccepted && !liveCancellationFinalized
                  ? 'cancellation_not_finalized'
                  : cancellation.reason

      return NextResponse.json({
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
      })
    } catch (error) {
      logger.error('Failed to cancel execution', {
        workflowId,
        executionId,
        error: toError(error).message,
      })
      return NextResponse.json(
        { error: toError(error).message || 'Failed to cancel execution' },
        { status: 500 }
      )
    }
  }
)
