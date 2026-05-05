import { db } from '@sim/db'
import { pausedExecutions } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { and, asc, eq, isNotNull, lte } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { acquireLock, releaseLock } from '@/lib/core/config/redis'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  computeEarliestResumeAt,
  PauseResumeManager,
} from '@/lib/workflows/executor/human-in-the-loop-manager'
import type { PausePoint } from '@/executor/types'

const logger = createLogger('TimePauseResumePoll')

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const LOCK_KEY = 'time-pause-resume-poll-lock'
const LOCK_TTL_SECONDS = 180
const POLL_BATCH_LIMIT = 200

interface DispatchFailure {
  executionId: string
  contextId: string
  error: string
}

interface RowResult {
  dispatched: number
  failures: DispatchFailure[]
}

export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateShortId()

  const authError = verifyCronAuth(request, 'Time-pause resume poll')
  if (authError) return authError

  const lockAcquired = await acquireLock(LOCK_KEY, requestId, LOCK_TTL_SECONDS)
  if (!lockAcquired) {
    return NextResponse.json(
      { success: true, message: 'Polling already in progress – skipped', requestId },
      { status: 202 }
    )
  }

  try {
    const now = new Date()

    const dueRows = await db
      .select({
        id: pausedExecutions.id,
        executionId: pausedExecutions.executionId,
        workflowId: pausedExecutions.workflowId,
        pausePoints: pausedExecutions.pausePoints,
        metadata: pausedExecutions.metadata,
      })
      .from(pausedExecutions)
      .where(
        and(
          eq(pausedExecutions.status, 'paused'),
          isNotNull(pausedExecutions.nextResumeAt),
          lte(pausedExecutions.nextResumeAt, now)
        )
      )
      .orderBy(asc(pausedExecutions.nextResumeAt))
      .limit(POLL_BATCH_LIMIT)

    const results = await Promise.all(dueRows.map((row) => dispatchRow(row, now)))
    const dispatched = results.reduce((sum, r) => sum + r.dispatched, 0)
    const failures = results.flatMap((r) => r.failures)

    logger.info('Time-pause resume poll completed', {
      requestId,
      claimedRows: dueRows.length,
      dispatched,
      failureCount: failures.length,
    })

    return NextResponse.json({
      success: true,
      requestId,
      claimedRows: dueRows.length,
      dispatched,
      failures,
    })
  } catch (error) {
    const message = toError(error).message
    logger.error('Time-pause resume poll failed', { requestId, error: message })
    return NextResponse.json({ success: false, requestId, error: message }, { status: 500 })
  } finally {
    await releaseLock(LOCK_KEY, requestId).catch(() => {})
  }
})

interface DueRow {
  id: string
  executionId: string
  workflowId: string
  pausePoints: unknown
  metadata: unknown
}

async function dispatchRow(row: DueRow, now: Date): Promise<RowResult> {
  const points = (row.pausePoints ?? {}) as Record<string, PausePoint>
  const metadata = (row.metadata ?? {}) as Record<string, unknown>
  const userId = typeof metadata.executorUserId === 'string' ? metadata.executorUserId : ''

  const eligiblePoints = Object.values(points).filter(
    (point) =>
      point.pauseKind === 'time' && (!point.resumeStatus || point.resumeStatus === 'paused')
  )
  const duePoints = eligiblePoints.filter((point) => {
    if (!point.resumeAt) return false
    const at = new Date(point.resumeAt)
    return !Number.isNaN(at.getTime()) && at <= now
  })

  const failures: DispatchFailure[] = []
  let dispatched = 0

  for (const point of duePoints) {
    if (!point.contextId) continue
    try {
      const enqueueResult = await PauseResumeManager.enqueueOrStartResume({
        executionId: row.executionId,
        contextId: point.contextId,
        resumeInput: {},
        userId,
        allowedPauseKinds: ['time'],
      })

      if (enqueueResult.status === 'starting') {
        PauseResumeManager.startResumeExecution({
          resumeEntryId: enqueueResult.resumeEntryId,
          resumeExecutionId: enqueueResult.resumeExecutionId,
          pausedExecution: enqueueResult.pausedExecution,
          contextId: enqueueResult.contextId,
          resumeInput: enqueueResult.resumeInput,
          userId: enqueueResult.userId,
        }).catch((error) => {
          logger.error('Background time-pause resume failed', {
            executionId: row.executionId,
            contextId: point.contextId,
            error: toError(error).message,
          })
        })
      }
      dispatched++
    } catch (error) {
      const message = toError(error).message
      logger.warn('Failed to dispatch time-pause resume', {
        executionId: row.executionId,
        contextId: point.contextId,
        error: message,
      })
      failures.push({ executionId: row.executionId, contextId: point.contextId, error: message })
    }
  }

  // We never auto-retry a failed dispatch: workflow blocks aren't idempotent, and
  // an operator must investigate stranded rows by hand. The status='paused' guard
  // also prevents clobbering when a concurrent manual resume has already advanced
  // the row's state since we read it.
  await PauseResumeManager.setNextResumeAt({
    pausedExecutionId: row.id,
    nextResumeAt: computeEarliestResumeAt(eligiblePoints, { after: now }),
  })

  return { dispatched, failures }
}
