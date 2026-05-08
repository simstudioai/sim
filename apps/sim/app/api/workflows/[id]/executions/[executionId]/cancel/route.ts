import { db } from '@sim/db'
import { workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { sleep } from '@sim/utils/helpers'
import { authorizeWorkflowByWorkspacePermission } from '@sim/workflow-authz'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { cancelWorkflowExecutionContract } from '@/lib/api/contracts/workflows'
import { parseRequest } from '@/lib/api/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
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

async function completePausedCancellationWithRetry(executionId: string): Promise<boolean> {
  for (let attempt = 1; attempt <= PAUSED_CANCELLATION_DB_ATTEMPTS; attempt++) {
    try {
      const cancelled = await PauseResumeManager.completePausedCancellation(executionId)
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
  workflowId: string
): Promise<boolean> {
  const metaState = await readExecutionMetaState(executionId)
  if (metaState.status === 'found' && metaState.meta.status === 'cancelled') {
    return true
  }

  const writer = createExecutionEventWriter(executionId)
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

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string; executionId: string }> }) => {
    const parsed = await parseRequest(cancelWorkflowExecutionContract, req, context)
    if (!parsed.success) return parsed.response
    const { id: workflowId, executionId } = parsed.data.params

    try {
      const auth = await checkHybridAuth(req, { requireWorkflowId: false })
      if (!auth.success || !auth.userId) {
        return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
      }

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

      logger.info('Cancel execution requested', { workflowId, executionId, userId: auth.userId })

      let pausedCancellationStarted = false
      let pausedCancelled = false
      try {
        pausedCancellationStarted = await PauseResumeManager.beginPausedCancellation(executionId)
      } catch (error) {
        logger.warn('Failed to begin paused execution cancellation in database', {
          executionId,
          error,
        })
      }
      const pendingPausedCancellation = pausedCancellationStarted
        ? null
        : await PauseResumeManager.getPausedCancellationStatus(executionId)
      const isPausedCancellationPath =
        pausedCancellationStarted || pendingPausedCancellation !== null

      const cancellation: ExecutionCancellationRecordResult = isPausedCancellationPath
        ? { durablyRecorded: false, reason: 'redis_unavailable' }
        : await markExecutionCancelled(executionId)
      const locallyAborted = isPausedCancellationPath ? false : abortManualExecution(executionId)

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

      if (!isPausedCancellationPath && (cancellation.durablyRecorded || locallyAborted)) {
        await PauseResumeManager.blockQueuedResumesForCancellation(executionId).catch((error) => {
          logger.warn('Failed to block queued paused resumes after cancellation', {
            executionId,
            error,
          })
        })
      } else if (!isPausedCancellationPath) {
        await PauseResumeManager.clearPausedCancellationIntent(executionId).catch((error) => {
          logger.warn(
            'Failed to clear paused cancellation intent after unsuccessful cancellation',
            {
              executionId,
              error,
            }
          )
        })
      }

      let pausedCancellationPublished = false
      let pausedCancellationPublishFailed = false
      if (pausedCancellationStarted) {
        pausedCancellationPublished = await ensurePausedCancellationEventPublished(
          executionId,
          workflowId
        )
        pausedCancellationPublishFailed = !pausedCancellationPublished
        if (pausedCancellationPublished) {
          pausedCancelled = await completePausedCancellationWithRetry(executionId)
        }
      } else {
        if (pendingPausedCancellation === 'cancelled') {
          pausedCancellationPublished = await ensurePausedCancellationEventPublished(
            executionId,
            workflowId
          )
          pausedCancellationPublishFailed = !pausedCancellationPublished
          pausedCancelled = pausedCancellationPublished
        } else if (pendingPausedCancellation === 'cancelling') {
          pausedCancellationPublished = await ensurePausedCancellationEventPublished(
            executionId,
            workflowId
          )
          pausedCancellationPublishFailed = !pausedCancellationPublished
          if (pausedCancellationPublished) {
            pausedCancelled = await completePausedCancellationWithRetry(executionId)
          }
        }
      }

      if (
        pausedCancellationPublishFailed &&
        (pausedCancellationStarted || pendingPausedCancellation === 'cancelling')
      ) {
        await PauseResumeManager.clearPausedCancellationIntent(executionId).catch((error) => {
          logger.warn('Failed to clear paused cancellation intent after publish failure', {
            executionId,
            error,
          })
        })
      }

      if ((cancellation.durablyRecorded || locallyAborted) && !pausedCancelled) {
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

      const success =
        (isPausedCancellationPath
          ? pausedCancelled && pausedCancellationPublished
          : cancellation.durablyRecorded) || locallyAborted

      if (success) {
        const workspaceId = workflowAuthorization.workflow?.workspaceId
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
    } catch (error: any) {
      logger.error('Failed to cancel execution', { workflowId, executionId, error: error.message })
      return NextResponse.json(
        { error: error.message || 'Failed to cancel execution' },
        { status: 500 }
      )
    }
  }
)
