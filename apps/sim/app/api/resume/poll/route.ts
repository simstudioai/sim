import { db } from '@sim/db'
import { pausedExecutions } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { and, asc, inArray, isNotNull, lte, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { acquireLock, releaseLock } from '@/lib/core/config/redis'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { preprocessExecution } from '@/lib/execution/preprocessing'
import {
  computeEarliestResumeAt,
  PauseResumeManager,
} from '@/lib/workflows/executor/human-in-the-loop-manager'
import {
  createPausedExecutionResumeMetadata,
  type PausedExecutionResumeMetadata,
  parsePausedExecutionResumeMetadata,
} from '@/lib/workflows/executor/paused-execution-metadata'
import {
  LEGACY_PAUSED_SNAPSHOT_FALLBACK_CHUNK_SIZE,
  MAX_PAUSED_EXECUTION_SNAPSHOT_BYTES,
} from '@/lib/workflows/executor/paused-execution-policy'
import {
  getResumeAdmissionRetryAt,
  normalizeAutomaticResumeWaitingReason,
} from '@/lib/workflows/executor/resume-policy'
import { ExecutionSnapshot } from '@/executor/execution/snapshot'
import type { PausePoint } from '@/executor/types'

const logger = createLogger('TimePauseResumePoll')

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const LOCK_KEY = 'time-pause-resume-poll-lock'
const LOCK_TTL_SECONDS = 180
const POLL_BATCH_LIMIT = 200
const POLL_PREPROCESSING_CONCURRENCY = 10
const OVERSIZED_LEGACY_SNAPSHOT_REASON = `Legacy paused execution snapshot exceeds the ${
  MAX_PAUSED_EXECUTION_SNAPSHOT_BYTES / (1024 * 1024)
} MiB automatic-resume safety limit and requires repair`

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
        metadata: sql<unknown>`jsonb_build_object(
          'executorUserId', ${pausedExecutions.metadata}->'executorUserId',
          'workspaceId', ${pausedExecutions.metadata}->'workspaceId',
          'billingAttribution', ${pausedExecutions.metadata}->'billingAttribution'
        )`,
      })
      .from(pausedExecutions)
      .where(
        and(
          // 'partially_resumed' rows occur when a chained-pause workflow advanced past
          // an earlier wait — e.g. wait1 → agent → wait2 — and now wait2's time pause
          // is the one waiting for the cron. Include it alongside fresh 'paused' rows.
          inArray(pausedExecutions.status, ['paused', 'partially_resumed']),
          isNotNull(pausedExecutions.nextResumeAt),
          lte(pausedExecutions.nextResumeAt, now)
        )
      )
      .orderBy(asc(pausedExecutions.nextResumeAt))
      .limit(POLL_BATCH_LIMIT)

    const preparedRows = await prepareDueRows(dueRows)
    const results = await mapWithConcurrency(preparedRows, POLL_PREPROCESSING_CONCURRENCY, (row) =>
      dispatchRowSafely(row, now)
    )
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

interface PreparedDueRow extends DueRow {
  resumeMetadata: PausedExecutionResumeMetadata | null
  resumeMetadataError?: string
}

interface LegacySnapshotRow {
  id: string
  executionSnapshot: unknown
}

interface LegacySnapshotSizeRow {
  id: string
  snapshotBytes: number
}

interface LegacyResumeMetadataResult {
  resumeMetadata: PausedExecutionResumeMetadata | null
  resumeMetadataError?: string
}

/**
 * Measures the serialized JSON text sent by the database driver. This matches
 * the cutover migration's byte accounting and avoids compressed TOAST size
 * undercounting.
 */
function pausedExecutionSnapshotBytesSql() {
  return sql<number>`octet_length(${pausedExecutions.executionSnapshot}::text)`
}

function isPausePoint(value: unknown): value is PausePoint {
  return isRecordLike(value) && typeof value.contextId === 'string'
}

function getPausePoints(value: unknown): PausePoint[] {
  return isRecordLike(value) ? Object.values(value).filter(isPausePoint) : []
}

function getLegacyExecutorUserId(metadata: unknown): string | undefined {
  if (!isRecordLike(metadata)) return undefined
  return typeof metadata.executorUserId === 'string' ? metadata.executorUserId : undefined
}

async function loadLegacyResumeMetadata(
  rows: DueRow[]
): Promise<Map<string, LegacyResumeMetadataResult>> {
  const results = new Map<string, LegacyResumeMetadataResult>()
  const snapshotSizeRows = (await db
    .select({
      id: pausedExecutions.id,
      snapshotBytes: pausedExecutionSnapshotBytesSql(),
    })
    .from(pausedExecutions)
    .where(
      inArray(
        pausedExecutions.id,
        rows.map((row) => row.id)
      )
    )
    .limit(POLL_BATCH_LIMIT)) as LegacySnapshotSizeRow[]

  const snapshotBytesById = new Map(
    snapshotSizeRows.map((row) => [row.id, Number(row.snapshotBytes)])
  )
  const eligibleIds: string[] = []
  for (const row of rows) {
    const snapshotBytes = snapshotBytesById.get(row.id)
    if (snapshotBytes === undefined || !Number.isFinite(snapshotBytes) || snapshotBytes < 0) {
      results.set(row.id, {
        resumeMetadata: null,
        resumeMetadataError: 'Legacy paused execution snapshot size is unavailable',
      })
    } else if (snapshotBytes > MAX_PAUSED_EXECUTION_SNAPSHOT_BYTES) {
      results.set(row.id, {
        resumeMetadata: null,
        resumeMetadataError: OVERSIZED_LEGACY_SNAPSHOT_REASON,
      })
    } else {
      eligibleIds.push(row.id)
    }
  }

  const rowsById = new Map(rows.map((row) => [row.id, row]))
  for (
    let offset = 0;
    offset < eligibleIds.length;
    offset += LEGACY_PAUSED_SNAPSHOT_FALLBACK_CHUNK_SIZE
  ) {
    const chunkIds = eligibleIds.slice(offset, offset + LEGACY_PAUSED_SNAPSHOT_FALLBACK_CHUNK_SIZE)
    const snapshotRows = (await db
      .select({
        id: pausedExecutions.id,
        executionSnapshot: pausedExecutions.executionSnapshot,
      })
      .from(pausedExecutions)
      .where(
        and(
          inArray(pausedExecutions.id, chunkIds),
          lte(pausedExecutionSnapshotBytesSql(), MAX_PAUSED_EXECUTION_SNAPSHOT_BYTES)
        )
      )
      .limit(LEGACY_PAUSED_SNAPSHOT_FALLBACK_CHUNK_SIZE)) as LegacySnapshotRow[]

    const loadedIds = new Set<string>()
    for (const snapshotRow of snapshotRows) {
      loadedIds.add(snapshotRow.id)
      const sourceRow = rowsById.get(snapshotRow.id)
      try {
        if (
          !sourceRow ||
          !isRecordLike(snapshotRow.executionSnapshot) ||
          typeof snapshotRow.executionSnapshot.snapshot !== 'string'
        ) {
          throw new Error('Legacy paused execution snapshot is missing')
        }
        const snapshot = ExecutionSnapshot.fromJSON(snapshotRow.executionSnapshot.snapshot)
        results.set(snapshotRow.id, {
          resumeMetadata: createPausedExecutionResumeMetadata(
            snapshot,
            getLegacyExecutorUserId(sourceRow.metadata)
          ),
        })
      } catch (error) {
        results.set(snapshotRow.id, {
          resumeMetadata: null,
          resumeMetadataError: toError(error).message,
        })
      }
    }

    for (const id of chunkIds) {
      if (!loadedIds.has(id)) {
        results.set(id, {
          resumeMetadata: null,
          resumeMetadataError:
            'Legacy paused execution snapshot is missing or exceeds the automatic-resume safety limit',
        })
      }
    }
  }

  return results
}

async function prepareDueRows(rows: DueRow[]): Promise<PreparedDueRow[]> {
  const parsedMetadata = rows.map((row) => parsePausedExecutionResumeMetadata(row.metadata))
  const legacyRows = rows.filter((_, index) => parsedMetadata[index] === null)
  if (legacyRows.length === 0) {
    return rows.map((row, index) => ({
      ...row,
      resumeMetadata: parsedMetadata[index],
    }))
  }

  const legacyMetadataById = await loadLegacyResumeMetadata(legacyRows)

  return rows.map((row, index) => {
    const currentMetadata = parsedMetadata[index]
    if (currentMetadata) {
      return { ...row, resumeMetadata: currentMetadata }
    }

    const legacyMetadata = legacyMetadataById.get(row.id)
    return {
      ...row,
      resumeMetadata: legacyMetadata?.resumeMetadata ?? null,
      resumeMetadataError:
        legacyMetadata?.resumeMetadataError ?? 'Legacy paused execution snapshot is unavailable',
    }
  })
}

async function dispatchRowSafely(row: PreparedDueRow, now: Date): Promise<RowResult> {
  try {
    return await dispatchRow(row, now)
  } catch (error) {
    const message = toError(error).message
    const contextId = getPausePoints(row.pausePoints)[0]?.contextId ?? 'automatic-resume'
    logger.warn('Failed to process time-pause resume row', {
      executionId: row.executionId,
      contextId,
      error: message,
    })
    return {
      dispatched: 0,
      failures: [{ executionId: row.executionId, contextId, error: message }],
    }
  }
}

async function recordAutomaticAdmissionWait(
  row: DueRow,
  contextId: string,
  reason: string,
  now: Date
): Promise<string> {
  const boundedReason = normalizeAutomaticResumeWaitingReason(reason)
  try {
    await PauseResumeManager.setAutomaticResumeWaiting({
      pausedExecutionId: row.id,
      contextId,
      reason: boundedReason,
      retryAt: getResumeAdmissionRetryAt(now),
    })
  } catch (error) {
    logger.warn('Failed to persist automatic resume waiting state', {
      executionId: row.executionId,
      contextId,
      error: toError(error).message,
    })
  }
  return boundedReason
}

async function dispatchRow(row: PreparedDueRow, now: Date): Promise<RowResult> {
  const points = getPausePoints(row.pausePoints)

  const eligiblePoints = points.filter(
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

  if (!row.resumeMetadata) {
    const metadataError =
      row.resumeMetadataError ?? 'Paused execution resume metadata is unavailable'
    const blockedPoints =
      duePoints.length > 0
        ? duePoints
        : points.filter(
            (point) => point.resumeStatus === 'queued' || point.resumeStatus === 'resuming'
          )
    const contextIds =
      blockedPoints.length > 0
        ? blockedPoints.map((point) => point.contextId)
        : ['automatic-resume']
    for (const contextId of contextIds) {
      const waitingReason = await recordAutomaticAdmissionWait(row, contextId, metadataError, now)
      failures.push({
        executionId: row.executionId,
        contextId,
        error: waitingReason,
      })
    }
    return { dispatched, failures }
  }

  if (duePoints.length === 0) {
    const queuedPoint = points.find((point) => point.resumeStatus === 'queued')
    const resumingPoint = points.find((point) => point.resumeStatus === 'resuming')
    try {
      await PauseResumeManager.processQueuedResumes(row.executionId, row.workflowId)
      if (!queuedPoint && !resumingPoint) {
        await PauseResumeManager.setNextResumeAt({
          pausedExecutionId: row.id,
          nextResumeAt: null,
        })
      }
    } catch (error) {
      const message = toError(error).message
      const contextId = queuedPoint?.contextId ?? 'queued-resume'
      const waitingReason = await recordAutomaticAdmissionWait(row, contextId, message, now)
      failures.push({
        executionId: row.executionId,
        contextId,
        error: waitingReason,
      })
    }
    return { dispatched, failures }
  }

  const { executorUserId, workspaceId, billingAttribution } = row.resumeMetadata
  let preprocessing: Awaited<ReturnType<typeof preprocessExecution>>
  try {
    preprocessing = await preprocessExecution({
      workflowId: row.workflowId,
      userId: executorUserId,
      triggerType: 'manual',
      executionId: row.executionId,
      requestId: `time-resume:${row.id}`,
      checkRateLimit: false,
      checkDeployment: false,
      skipConcurrencyReservation: true,
      logPreprocessingErrors: false,
      workspaceId,
      billingAttribution,
    })
  } catch (error) {
    for (const point of duePoints) {
      if (!point.contextId) continue
      const waitingReason = await recordAutomaticAdmissionWait(
        row,
        point.contextId,
        toError(error).message,
        now
      )
      failures.push({
        executionId: row.executionId,
        contextId: point.contextId,
        error: waitingReason,
      })
    }
    return { dispatched, failures }
  }

  if (!preprocessing.success) {
    for (const point of duePoints) {
      if (!point.contextId) continue
      const waitingReason = await recordAutomaticAdmissionWait(
        row,
        point.contextId,
        preprocessing.error?.message ?? 'Resume admission failed',
        now
      )
      failures.push({
        executionId: row.executionId,
        contextId: point.contextId,
        error: waitingReason,
      })
    }
    return { dispatched, failures }
  }

  for (const point of duePoints) {
    if (!point.contextId) continue
    try {
      const enqueueResult = await PauseResumeManager.enqueueOrStartResume({
        executionId: row.executionId,
        workflowId: row.workflowId,
        contextId: point.contextId,
        resumeInput: {},
        userId: executorUserId,
        allowedPauseKinds: ['time'],
      })

      if (enqueueResult.status === 'starting') {
        /**
         * Route through `executeResumeJob` so cell-context restoration and
         * cascade continuation use the same primitive as the background task.
         */
        const { executeResumeJob } = await import('@/background/resume-execution')
        void executeResumeJob({
          resumeEntryId: enqueueResult.resumeEntryId,
          resumeExecutionId: enqueueResult.resumeExecutionId,
          pausedExecutionId: enqueueResult.pausedExecution.id,
          contextId: enqueueResult.contextId,
          resumeInput: enqueueResult.resumeInput,
          userId: enqueueResult.userId,
          workflowId: row.workflowId,
          parentExecutionId: row.executionId,
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

  /**
   * Read-only admission failures happen before input/state claims. The claimed
   * resume acquires its fresh atomic reservation inside PauseResumeManager;
   * reservation failures restore that same queued input for a bounded retry.
   * Execution/dispatch failures keep the existing manual investigation
   * behavior because workflow blocks are not idempotent.
   */
  await PauseResumeManager.setNextResumeAt({
    pausedExecutionId: row.id,
    nextResumeAt: computeEarliestResumeAt(eligiblePoints, { after: now }),
  })

  return { dispatched, failures }
}
