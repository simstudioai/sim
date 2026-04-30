import { db } from '@sim/db'
import { pausedExecutions } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { and, eq, isNotNull, lte } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { acquireLock, releaseLock } from '@/lib/core/config/redis'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'

const logger = createLogger('TimePauseResumePoll')

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const LOCK_KEY = 'time-pause-resume-poll-lock'
const LOCK_TTL_SECONDS = 120
const POLL_BATCH_LIMIT = 200

interface StoredPausePoint {
  contextId?: string
  resumeStatus?: string
  pauseKind?: string
  resumeAt?: string
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

  let claimedRows = 0
  let dispatched = 0
  const failures: { executionId: string; contextId: string; error: string }[] = []

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
      .limit(POLL_BATCH_LIMIT)

    claimedRows = dueRows.length

    for (const row of dueRows) {
      const points = (row.pausePoints ?? {}) as Record<string, StoredPausePoint>
      const metadata = (row.metadata ?? {}) as Record<string, unknown>
      const userId = typeof metadata.executorUserId === 'string' ? metadata.executorUserId : ''

      const duePoints: StoredPausePoint[] = []
      let nextRemaining: Date | null = null

      for (const point of Object.values(points)) {
        if (point.pauseKind !== 'time' || !point.resumeAt) continue
        if (point.resumeStatus && point.resumeStatus !== 'paused') continue

        const resumeAt = new Date(point.resumeAt)
        if (Number.isNaN(resumeAt.getTime())) continue

        if (resumeAt <= now) {
          duePoints.push(point)
        } else if (!nextRemaining || resumeAt < nextRemaining) {
          nextRemaining = resumeAt
        }
      }

      for (const point of duePoints) {
        const contextId = point.contextId
        if (!contextId) continue
        try {
          const enqueueResult = await PauseResumeManager.enqueueOrStartResume({
            executionId: row.executionId,
            contextId,
            resumeInput: {},
            userId,
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
                contextId,
                error: toError(error).message,
              })
            })
          }
          dispatched++
        } catch (error) {
          const message = toError(error).message
          logger.warn('Failed to dispatch time-pause resume', {
            executionId: row.executionId,
            contextId,
            error: message,
          })
          failures.push({ executionId: row.executionId, contextId, error: message })
        }
      }

      // We never auto-retry a failed dispatch: workflow blocks aren't idempotent, and an
      // operator must investigate stranded rows by hand. Setting nextResumeAt to the next
      // future pause (or null) drops the row out of the poll, surfacing the failure.
      await db
        .update(pausedExecutions)
        .set({ nextResumeAt: nextRemaining })
        .where(eq(pausedExecutions.id, row.id))
    }

    logger.info('Time-pause resume poll completed', {
      requestId,
      claimedRows,
      dispatched,
      failureCount: failures.length,
    })

    return NextResponse.json({
      success: true,
      requestId,
      claimedRows,
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
