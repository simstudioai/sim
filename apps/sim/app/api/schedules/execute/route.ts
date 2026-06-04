import { asyncJobs, db, workflow, workflowDeploymentVersion, workflowSchedule } from '@sim/db'
import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { toError } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { backoffWithJitter } from '@sim/utils/retry'
import { Cron } from 'croner'
import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import type { ExecuteSchedulesResponse } from '@/lib/api/contracts/schedules'
import { verifyCronAuth } from '@/lib/auth/internal'
import { getJobQueue, shouldExecuteInline } from '@/lib/core/async-jobs'
import { JOB_STATUS, type Job } from '@/lib/core/async-jobs/types'
import { isRetryableInfrastructureError } from '@/lib/core/errors/retryable-infrastructure'
import { getMaxExecutionTimeout } from '@/lib/core/execution-limits'
import { runDetached } from '@/lib/core/utils/background'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  SCHEDULE_EXECUTION_CONCURRENCY_LIMIT,
  SCHEDULE_EXECUTION_QUEUE_NAME,
  SCHEDULE_INFRA_RETRY_BASE_MS,
  SCHEDULE_INFRA_RETRY_MAX_ATTEMPTS,
  SCHEDULE_INFRA_RETRY_MAX_MS,
  SCHEDULE_JITTER_MAX_MS,
  SCHEDULE_WORKFLOW_ENQUEUE_LIMIT,
} from '@/lib/workflows/schedules/execution-limits'
import {
  buildScheduleFailureUpdate,
  executeJobInline,
  executeScheduleJob,
  releaseScheduleLock,
  type ScheduleExecutionPayload,
} from '@/background/schedule-execution'

export const dynamic = 'force-dynamic'
export const maxDuration = 3600

const logger = createLogger('ScheduledExecuteAPI')
const WORKFLOW_CHUNK_SIZE = 100
const JOB_CHUNK_SIZE = 100
const MAX_TICK_DURATION_MS = 3 * 60 * 1000
const STALE_SCHEDULE_CLAIM_MS = getMaxExecutionTimeout()
const STALE_SCHEDULE_RECOVERY_BATCH_SIZE = 100
const DATABASE_SCHEDULE_START_TURN_WAIT_MS = 1_000
type DatabaseScheduleStartResult = 'started' | 'capacity_full' | 'not_pending'
let databaseScheduleStartTurn: Promise<void> | null = null

const dueFilter = (queuedAt: Date) =>
  and(
    isNull(workflowSchedule.archivedAt),
    lte(workflowSchedule.nextRunAt, queuedAt),
    sql`${workflowSchedule.status} NOT IN ('disabled', 'completed')`,
    or(
      isNull(workflowSchedule.lastQueuedAt),
      lt(workflowSchedule.lastQueuedAt, workflowSchedule.nextRunAt),
      lt(workflowSchedule.lastQueuedAt, new Date(queuedAt.getTime() - STALE_SCHEDULE_CLAIM_MS))
    )
  )

const activeWorkflowDeploymentFilter = () =>
  sql`${workflowSchedule.deploymentVersionId} = (select ${workflowDeploymentVersion.id} from ${workflowDeploymentVersion} where ${workflowDeploymentVersion.workflowId} = ${workflowSchedule.workflowId} and ${workflowDeploymentVersion.isActive} = true)`

const workflowScheduleFilter = (queuedAt: Date) =>
  and(
    dueFilter(queuedAt),
    sql`(${workflowSchedule.sourceType} = 'workflow' OR ${workflowSchedule.sourceType} IS NULL)`,
    activeWorkflowDeploymentFilter()
  )

const jobScheduleFilter = (queuedAt: Date) =>
  and(dueFilter(queuedAt), sql`${workflowSchedule.sourceType} = 'job'`)

async function runWithDatabaseScheduleStartTurn(
  operation: () => Promise<DatabaseScheduleStartResult>
): Promise<DatabaseScheduleStartResult> {
  const activeTurn = databaseScheduleStartTurn
  if (activeTurn) {
    const turnOpened = await Promise.race([
      activeTurn.then(() => true),
      sleep(DATABASE_SCHEDULE_START_TURN_WAIT_MS).then(() => false),
    ])
    if (!turnOpened || databaseScheduleStartTurn) return 'capacity_full'
  }

  let releaseTurn = () => {}
  const currentTurn = new Promise<void>((resolve) => {
    releaseTurn = resolve
  })
  databaseScheduleStartTurn = currentTurn

  try {
    return await operation()
  } finally {
    if (databaseScheduleStartTurn === currentTurn) {
      databaseScheduleStartTurn = null
    }
    releaseTurn()
  }
}

function buildScheduleExecutionJobId(schedule: {
  id: string
  nextRunAt?: Date | null
  lastQueuedAt?: Date | null
}): string {
  const occurrence =
    schedule.nextRunAt?.toISOString() ?? schedule.lastQueuedAt?.toISOString() ?? 'due'
  return `schedule_${sha256Hex(`${schedule.id}:${occurrence}`).slice(0, 32)}`
}

function getNextRunFromCronExpression(
  cronExpression?: string | null,
  timezone = 'UTC'
): Date | null {
  if (!cronExpression) return null
  const cron = new Cron(cronExpression, { timezone })
  return cron.nextRun()
}

async function claimWorkflowSchedules(queuedAt: Date, limit: number) {
  if (limit <= 0) return []

  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: workflowSchedule.id,
        workspaceId: workflow.workspaceId,
      })
      .from(workflowSchedule)
      .innerJoin(workflow, eq(workflowSchedule.workflowId, workflow.id))
      .where(workflowScheduleFilter(queuedAt))
      .for('update', { skipLocked: true })
      .limit(limit)

    if (rows.length === 0) return []
    const workspaceIdsByScheduleId = new Map(rows.map((row) => [row.id, row.workspaceId]))

    const claimedRows = await tx
      .update(workflowSchedule)
      .set({ lastQueuedAt: queuedAt, updatedAt: queuedAt })
      .where(
        and(
          workflowScheduleFilter(queuedAt),
          inArray(
            workflowSchedule.id,
            rows.map((row) => row.id)
          )
        )
      )
      .returning({
        id: workflowSchedule.id,
        workflowId: workflowSchedule.workflowId,
        blockId: workflowSchedule.blockId,
        cronExpression: workflowSchedule.cronExpression,
        lastRanAt: workflowSchedule.lastRanAt,
        failedCount: workflowSchedule.failedCount,
        infraRetryCount: workflowSchedule.infraRetryCount,
        nextRunAt: workflowSchedule.nextRunAt,
        lastQueuedAt: workflowSchedule.lastQueuedAt,
        timezone: workflowSchedule.timezone,
        deploymentVersionId: workflowSchedule.deploymentVersionId,
        sourceType: workflowSchedule.sourceType,
      })

    return claimedRows.map((row) => ({
      ...row,
      workspaceId: workspaceIdsByScheduleId.get(row.id) ?? null,
    }))
  })
}

async function claimJobSchedules(queuedAt: Date, limit: number) {
  if (limit <= 0) return []

  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: workflowSchedule.id })
      .from(workflowSchedule)
      .where(jobScheduleFilter(queuedAt))
      .for('update', { skipLocked: true })
      .limit(limit)

    if (rows.length === 0) return []

    return tx
      .update(workflowSchedule)
      .set({ lastQueuedAt: queuedAt, updatedAt: queuedAt })
      .where(
        and(
          jobScheduleFilter(queuedAt),
          inArray(
            workflowSchedule.id,
            rows.map((row) => row.id)
          )
        )
      )
      .returning({
        id: workflowSchedule.id,
        cronExpression: workflowSchedule.cronExpression,
        timezone: workflowSchedule.timezone,
        failedCount: workflowSchedule.failedCount,
        lastQueuedAt: workflowSchedule.lastQueuedAt,
        sourceType: workflowSchedule.sourceType,
      })
  })
}

type ClaimedSchedule = Awaited<ReturnType<typeof claimWorkflowSchedules>>[number]
type ClaimedJob = Awaited<ReturnType<typeof claimJobSchedules>>[number]
type JobQueue = Awaited<ReturnType<typeof getJobQueue>>
type DatabaseScheduleExecutionTarget = Pick<
  ClaimedSchedule,
  'id' | 'workflowId' | 'cronExpression' | 'timezone'
>

function getSchedulePayloadFromValue(payload: unknown): ScheduleExecutionPayload | null {
  if (!payload || typeof payload !== 'object') return null
  const candidate = payload as Partial<ScheduleExecutionPayload>
  if (
    typeof candidate.scheduleId !== 'string' ||
    typeof candidate.workflowId !== 'string' ||
    typeof candidate.now !== 'string'
  ) {
    return null
  }

  return candidate as ScheduleExecutionPayload
}

function getSchedulePayloadFromJob(job: Job): ScheduleExecutionPayload | null {
  return getSchedulePayloadFromValue(job.payload)
}

function getSchedulePayloadClaimedAt(payload: ScheduleExecutionPayload | null): Date | null {
  if (!payload) return null
  const claimedAt = new Date(payload.now)
  return Number.isNaN(claimedAt.getTime()) ? null : claimedAt
}

async function restoreScheduleClaim(
  scheduleId: string,
  requestId: string,
  currentClaim: Date,
  activeClaim: Date,
  context: string
): Promise<void> {
  if (currentClaim.getTime() === activeClaim.getTime()) return

  const [restored] = await db
    .update(workflowSchedule)
    .set({ lastQueuedAt: activeClaim, updatedAt: new Date() })
    .where(
      and(
        eq(workflowSchedule.id, scheduleId),
        isNull(workflowSchedule.archivedAt),
        eq(workflowSchedule.lastQueuedAt, currentClaim)
      )
    )
    .returning({ id: workflowSchedule.id })
    .catch((error) => {
      logger.error(`[${requestId}] ${context}`, error)
      throw error
    })

  if (!restored) {
    const error = new Error(`Schedule claim restore did not update schedule ${scheduleId}`)
    logger.warn(`[${requestId}] ${context}`, {
      scheduleId,
      currentClaim: currentClaim.toISOString(),
      activeClaim: activeClaim.toISOString(),
    })
    throw error
  }
}

function getStaleScheduleExecutionCutoff(now: Date): Date {
  return new Date(now.getTime() - STALE_SCHEDULE_CLAIM_MS)
}

function isStaleScheduleClaim(claimedAt: Date): boolean {
  return claimedAt < getStaleScheduleExecutionCutoff(new Date())
}

function activeScheduleExecutionJobsFilter() {
  return sql`${asyncJobs.type} = 'schedule-execution' AND ${asyncJobs.status} = 'processing'`
}

function pendingScheduleExecutionJobsFilter(now: Date) {
  return and(
    sql`${asyncJobs.type} = 'schedule-execution' AND ${asyncJobs.status} = 'pending'`,
    sql`${asyncJobs.attempts} < ${asyncJobs.maxAttempts}`,
    or(isNull(asyncJobs.runAt), lte(asyncJobs.runAt, now))
  )
}

function staleScheduleExecutionJobsFilter(staleStartedBefore: Date) {
  return and(
    activeScheduleExecutionJobsFilter(),
    or(isNull(asyncJobs.startedAt), lt(asyncJobs.startedAt, staleStartedBefore))
  )
}

function getScheduleNextRunAt(
  schedule: { cronExpression?: string | null; timezone?: string },
  now: Date
): Date {
  return (
    getNextRunFromCronExpression(schedule.cronExpression, schedule.timezone) ??
    new Date(now.getTime() + 24 * 60 * 60 * 1000)
  )
}

async function markClaimedScheduleFailed(
  schedule: DatabaseScheduleExecutionTarget,
  requestId: string,
  expectedLastQueuedAt: Date,
  context: string
): Promise<void> {
  const now = new Date()
  await db
    .update(workflowSchedule)
    .set(buildScheduleFailureUpdate(now, getScheduleNextRunAt(schedule, now)))
    .where(
      and(
        eq(workflowSchedule.id, schedule.id),
        isNull(workflowSchedule.archivedAt),
        eq(workflowSchedule.lastQueuedAt, expectedLastQueuedAt)
      )
    )
    .catch((error) => {
      logger.error(`[${requestId}] ${context}`, error)
      throw error
    })
}

async function deferClaimedScheduleAfterQueueFailure(
  schedule: ClaimedSchedule,
  requestId: string,
  expectedLastQueuedAt: Date,
  error: unknown,
  context: string
): Promise<void> {
  const now = new Date()
  const retryAttempt = (schedule.infraRetryCount || 0) + 1
  if (retryAttempt > SCHEDULE_INFRA_RETRY_MAX_ATTEMPTS) {
    await markClaimedScheduleFailed(
      schedule,
      requestId,
      expectedLastQueuedAt,
      `Failed to mark schedule ${schedule.id} failed after queue retry exhaustion`
    )
    return
  }

  const retryDelayMs = Math.min(
    SCHEDULE_INFRA_RETRY_MAX_MS,
    Math.round(
      backoffWithJitter(retryAttempt, null, {
        baseMs: SCHEDULE_INFRA_RETRY_BASE_MS,
        maxMs: SCHEDULE_INFRA_RETRY_MAX_MS,
      })
    )
  )
  const nextRetryAt = new Date(now.getTime() + retryDelayMs)

  logger.warn(`[${requestId}] Deferring schedule after queue infrastructure failure`, {
    scheduleId: schedule.id,
    workflowId: schedule.workflowId,
    retryAttempt,
    retryDelayMs,
    error: toError(error).message,
  })

  await db
    .update(workflowSchedule)
    .set({
      updatedAt: now,
      nextRunAt: nextRetryAt,
      lastQueuedAt: null,
      infraRetryCount: retryAttempt,
    })
    .where(
      and(
        eq(workflowSchedule.id, schedule.id),
        isNull(workflowSchedule.archivedAt),
        eq(workflowSchedule.lastQueuedAt, expectedLastQueuedAt)
      )
    )
    .catch((updateError) => {
      logger.error(`[${requestId}] ${context}`, updateError)
      throw updateError
    })
}

async function handleClaimedScheduleSetupFailure(
  schedule: ClaimedSchedule,
  requestId: string,
  expectedLastQueuedAt: Date,
  error: unknown,
  retryContext: string,
  failureContext: string
): Promise<void> {
  if (isRetryableInfrastructureError(error)) {
    await deferClaimedScheduleAfterQueueFailure(
      schedule,
      requestId,
      expectedLastQueuedAt,
      error,
      retryContext
    )
    return
  }

  logger.error(`[${requestId}] Non-retryable schedule setup failure`, {
    scheduleId: schedule.id,
    workflowId: schedule.workflowId,
    error: toError(error).message,
  })
  await markClaimedScheduleFailed(schedule, requestId, expectedLastQueuedAt, failureContext)
}

async function recoverStaleDatabaseScheduleJobs(now: Date): Promise<void> {
  const staleStartedBefore = getStaleScheduleExecutionCutoff(now)

  await db.transaction(async (tx) => {
    const [lock] = await tx.execute<{ acquired: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(hashtext(${SCHEDULE_EXECUTION_QUEUE_NAME})) AS acquired`
    )
    if (!lock?.acquired) {
      logger.info(
        'Skipped stale database schedule job recovery because another worker holds the lock'
      )
      return
    }

    const staleRows = await tx
      .select({
        id: asyncJobs.id,
        payload: asyncJobs.payload,
        attempts: asyncJobs.attempts,
        maxAttempts: asyncJobs.maxAttempts,
      })
      .from(asyncJobs)
      .where(staleScheduleExecutionJobsFilter(staleStartedBefore))
      .orderBy(asc(asyncJobs.startedAt), asc(asyncJobs.id))
      .limit(STALE_SCHEDULE_RECOVERY_BATCH_SIZE)

    const exhaustedRows = staleRows.filter((row) => row.attempts >= row.maxAttempts)
    const retryableRows = staleRows.filter((row) => row.attempts < row.maxAttempts)

    if (exhaustedRows.length > 0) {
      await tx
        .update(asyncJobs)
        .set({
          status: JOB_STATUS.FAILED,
          completedAt: now,
          error: 'Stale schedule execution processing lease exhausted retry attempts',
          updatedAt: now,
        })
        .where(
          inArray(
            asyncJobs.id,
            exhaustedRows.map((row) => row.id)
          )
        )
    }

    for (const row of exhaustedRows) {
      const payload = getSchedulePayloadFromValue(row.payload)
      const claimedAt = getSchedulePayloadClaimedAt(payload)
      if (!payload || !claimedAt) continue

      await tx
        .update(workflowSchedule)
        .set(buildScheduleFailureUpdate(now, getScheduleNextRunAt(payload, now)))
        .where(
          and(
            eq(workflowSchedule.id, payload.scheduleId),
            isNull(workflowSchedule.archivedAt),
            eq(workflowSchedule.lastQueuedAt, claimedAt)
          )
        )
    }

    if (retryableRows.length > 0) {
      await tx
        .update(asyncJobs)
        .set({
          status: JOB_STATUS.PENDING,
          startedAt: null,
          error: 'Recovered after stale schedule execution processing lease',
          updatedAt: now,
        })
        .where(
          inArray(
            asyncJobs.id,
            retryableRows.map((row) => row.id)
          )
        )
    }
  })
}

function isStaleDatabaseScheduleJob(job: { status: string; startedAt?: Date }): boolean {
  return (
    job.status === JOB_STATUS.PROCESSING &&
    (!job.startedAt || job.startedAt < getStaleScheduleExecutionCutoff(new Date()))
  )
}

async function getDatabaseScheduleExecutionSlots(): Promise<number> {
  const [row] = await db
    .select({
      count: sql<number>`count(*)`,
    })
    .from(asyncJobs)
    .where(activeScheduleExecutionJobsFilter())

  const processingCount = Number(row?.count ?? 0)
  return Math.max(0, SCHEDULE_EXECUTION_CONCURRENCY_LIMIT - processingCount)
}

async function tryStartDatabaseScheduleJob(jobId: string): Promise<DatabaseScheduleStartResult> {
  const now = new Date()

  return db.transaction(async (tx) => {
    const [lock] = await tx.execute<{ acquired: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(hashtext(${SCHEDULE_EXECUTION_QUEUE_NAME})) AS acquired`
    )
    if (!lock?.acquired) return 'capacity_full'

    const [row] = await tx
      .select({
        count: sql<number>`count(*)`,
      })
      .from(asyncJobs)
      .where(activeScheduleExecutionJobsFilter())

    if (Number(row?.count ?? 0) >= SCHEDULE_EXECUTION_CONCURRENCY_LIMIT) {
      return 'capacity_full'
    }

    const [startedJob] = await tx
      .update(asyncJobs)
      .set({
        status: JOB_STATUS.PROCESSING,
        startedAt: now,
        attempts: sql`${asyncJobs.attempts} + 1`,
        updatedAt: now,
      })
      .where(and(eq(asyncJobs.id, jobId), eq(asyncJobs.status, JOB_STATUS.PENDING)))
      .returning({ id: asyncJobs.id })

    return startedJob ? 'started' : 'not_pending'
  })
}

async function executeDatabaseScheduleJob(
  jobQueue: JobQueue,
  jobId: string,
  payload: ScheduleExecutionPayload,
  schedule: DatabaseScheduleExecutionTarget,
  queuedAt: Date,
  requestId: string,
  delayMs: number
): Promise<void> {
  if (delayMs > 0) await sleep(delayMs)

  const startResult = await runWithDatabaseScheduleStartTurn(() =>
    tryStartDatabaseScheduleJob(jobId)
  )
  if (startResult === 'not_pending') {
    logger.info(`[${requestId}] Database schedule execution job is no longer pending`, {
      scheduleId: schedule.id,
      workflowId: schedule.workflowId,
      jobId,
    })
    return
  }

  if (startResult === 'capacity_full') {
    logger.info(`[${requestId}] Deferred database schedule execution because capacity is full`, {
      scheduleId: schedule.id,
      workflowId: schedule.workflowId,
      jobId,
      concurrencyLimit: SCHEDULE_EXECUTION_CONCURRENCY_LIMIT,
    })
    return
  }

  try {
    const output = await executeScheduleJob(payload)
    await jobQueue.completeJob(jobId, output ?? null)
  } catch (error) {
    const errorMessage = toError(error).message
    logger.error(`[${requestId}] Schedule execution failed for workflow ${schedule.workflowId}`, {
      scheduleId: schedule.id,
      jobId,
      error: errorMessage,
    })
    await jobQueue.markJobFailed(jobId, errorMessage)
    await releaseScheduleLock(
      schedule.id,
      requestId,
      new Date(),
      `Failed to release lock for schedule ${schedule.id} after inline execution failure`,
      undefined,
      { expectedLastQueuedAt: queuedAt }
    )
  }
}

async function getPendingDatabaseScheduleJobs(limit: number) {
  if (limit <= 0) return []
  const now = new Date()

  return db
    .select({
      id: asyncJobs.id,
      payload: asyncJobs.payload,
    })
    .from(asyncJobs)
    .where(pendingScheduleExecutionJobsFilter(now))
    .orderBy(asc(asyncJobs.runAt), asc(asyncJobs.createdAt), asc(asyncJobs.id))
    .limit(limit)
}

function getScheduleTargetFromPayload(
  payload: ScheduleExecutionPayload
): DatabaseScheduleExecutionTarget {
  return {
    id: payload.scheduleId,
    workflowId: payload.workflowId,
    cronExpression: payload.cronExpression ?? null,
    timezone: payload.timezone ?? 'UTC',
  }
}

async function getScheduleClaimState(
  payload: ScheduleExecutionPayload,
  claimedAt: Date
): Promise<'matches' | 'released' | 'claimed_by_other'> {
  const [schedule] = await db
    .select({
      lastQueuedAt: workflowSchedule.lastQueuedAt,
    })
    .from(workflowSchedule)
    .where(and(eq(workflowSchedule.id, payload.scheduleId), isNull(workflowSchedule.archivedAt)))
    .limit(1)

  if (!schedule?.lastQueuedAt) return 'released'
  return schedule.lastQueuedAt.getTime() === claimedAt.getTime() ? 'matches' : 'claimed_by_other'
}

async function resumePendingDatabaseScheduleJobs(
  jobQueue: JobQueue,
  requestId: string,
  slots: number
): Promise<number> {
  const pendingJobs = await getPendingDatabaseScheduleJobs(slots)
  if (pendingJobs.length === 0) return 0

  const results = await Promise.allSettled(
    pendingJobs.map(async (job) => {
      const payload = getSchedulePayloadFromValue(job.payload)
      const claimedAt = getSchedulePayloadClaimedAt(payload)
      if (!payload || !claimedAt) {
        await jobQueue.markJobFailed(job.id, 'Invalid pending schedule execution payload')
        return true
      }

      const claimState = await getScheduleClaimState(payload, claimedAt)
      if (claimState === 'released') {
        logger.info(`[${requestId}] Completing stale pending schedule execution job`, {
          scheduleId: payload.scheduleId,
          workflowId: payload.workflowId,
          jobId: job.id,
        })
        await jobQueue.completeJob(job.id, {
          skipped: true,
          reason: 'schedule claim no longer matches pending job occurrence',
        })
        return true
      }
      if (claimState === 'claimed_by_other') {
        logger.info(`[${requestId}] Leaving pending schedule execution job for active claimant`, {
          scheduleId: payload.scheduleId,
          workflowId: payload.workflowId,
          jobId: job.id,
        })
        return false
      }

      logger.info(`[${requestId}] Resuming pending database schedule execution job`, {
        scheduleId: payload.scheduleId,
        workflowId: payload.workflowId,
        jobId: job.id,
      })

      await executeDatabaseScheduleJob(
        jobQueue,
        job.id,
        payload,
        getScheduleTargetFromPayload(payload),
        claimedAt,
        requestId,
        0
      )
      return true
    })
  )

  let processedCount = 0
  results.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value) {
      processedCount += 1
      return
    }

    if (result.status === 'rejected') {
      logger.error(`[${requestId}] Failed to resume pending database schedule execution job`, {
        jobId: pendingJobs[index]?.id,
        error: toError(result.reason).message,
      })
    }
  })

  return processedCount
}

async function processScheduleItem(
  schedule: ClaimedSchedule,
  queuedAt: Date,
  requestId: string,
  jobQueue: JobQueue,
  useDatabaseFallback: boolean
) {
  const queueTime = schedule.lastQueuedAt ?? queuedAt
  const executionId = generateId()
  const correlation = {
    executionId,
    requestId,
    source: 'schedule' as const,
    workflowId: schedule.workflowId!,
    scheduleId: schedule.id,
    triggerType: 'schedule',
    scheduledFor: schedule.nextRunAt?.toISOString(),
  }

  const payload = {
    scheduleId: schedule.id,
    workflowId: schedule.workflowId!,
    executionId,
    requestId,
    correlation,
    blockId: schedule.blockId || undefined,
    workspaceId: schedule.workspaceId || undefined,
    deploymentVersionId: schedule.deploymentVersionId || undefined,
    cronExpression: schedule.cronExpression || undefined,
    timezone: schedule.timezone || undefined,
    lastRanAt: schedule.lastRanAt?.toISOString(),
    failedCount: schedule.failedCount || 0,
    infraRetryCount: schedule.infraRetryCount || 0,
    now: queueTime.toISOString(),
    scheduledFor: schedule.nextRunAt?.toISOString(),
  }

  let enqueuedJobId: string | null = null

  try {
    const delayMs = Math.floor(Math.random() * SCHEDULE_JITTER_MAX_MS)

    const scheduleJobId = buildScheduleExecutionJobId(schedule)
    const existingJob = await jobQueue.getJob(scheduleJobId)
    if (existingJob && ['pending', 'processing'].includes(existingJob.status)) {
      const activeJobPayload = getSchedulePayloadFromJob(existingJob)
      const activeJobClaim = getSchedulePayloadClaimedAt(activeJobPayload)

      if (useDatabaseFallback && isStaleDatabaseScheduleJob(existingJob)) {
        await recoverStaleDatabaseScheduleJobs(new Date())
        logger.info(`[${requestId}] Recovered stale database schedule execution jobs`, {
          scheduleId: schedule.id,
          jobId: scheduleJobId,
        })
      }

      const databaseJob = useDatabaseFallback ? await jobQueue.getJob(scheduleJobId) : existingJob
      const databaseJobPayload = databaseJob ? getSchedulePayloadFromJob(databaseJob) : null
      const databaseJobClaim = getSchedulePayloadClaimedAt(databaseJobPayload) ?? activeJobClaim
      if (!useDatabaseFallback && activeJobClaim && isStaleScheduleClaim(activeJobClaim)) {
        logger.warn(`[${requestId}] Cancelling stale schedule execution job`, {
          scheduleId: schedule.id,
          jobId: existingJob.id,
          claimedAt: activeJobClaim.toISOString(),
        })
        await jobQueue.cancelJob(existingJob.id)
        await releaseScheduleLock(
          schedule.id,
          requestId,
          queuedAt,
          `Released stale schedule ${schedule.id} after cancelling stale schedule execution job`,
          undefined,
          { expectedLastQueuedAt: queueTime }
        )
        return
      }

      if (useDatabaseFallback && databaseJob?.status === JOB_STATUS.PENDING) {
        logger.info(`[${requestId}] Resuming pending database schedule execution job`, {
          scheduleId: schedule.id,
          jobId: scheduleJobId,
        })
        if (databaseJobClaim) {
          await restoreScheduleClaim(
            schedule.id,
            requestId,
            queueTime,
            databaseJobClaim,
            `Failed to restore schedule ${schedule.id} claim for pending database fallback job`
          )
        }
        enqueuedJobId = scheduleJobId
        await executeDatabaseScheduleJob(
          jobQueue,
          scheduleJobId,
          databaseJobPayload ?? payload,
          schedule,
          databaseJobClaim ?? queueTime,
          requestId,
          delayMs
        )
        return
      }
      if (
        useDatabaseFallback &&
        databaseJob &&
        databaseJob.status !== JOB_STATUS.PENDING &&
        databaseJob.status !== JOB_STATUS.PROCESSING
      ) {
        logger.info(`[${requestId}] Database schedule execution job reached terminal state`, {
          scheduleId: schedule.id,
          jobId: scheduleJobId,
          status: databaseJob.status,
        })
        if (databaseJob.status === JOB_STATUS.FAILED) {
          await markClaimedScheduleFailed(
            schedule,
            requestId,
            queueTime,
            `Failed to mark schedule ${schedule.id} failed after terminal database fallback job`
          )
          return
        }

        await releaseScheduleLock(
          schedule.id,
          requestId,
          queuedAt,
          `Released stale schedule ${schedule.id} for terminal database fallback job ${scheduleJobId}`,
          getNextRunFromCronExpression(schedule.cronExpression, schedule.timezone),
          { expectedLastQueuedAt: queueTime }
        )
        return
      }

      logger.info(`[${requestId}] Schedule execution job already exists`, {
        scheduleId: schedule.id,
        jobId: scheduleJobId,
        status: databaseJob?.status ?? existingJob.status,
      })
      const shouldRestoreActiveClaim =
        activeJobClaim &&
        (!useDatabaseFallback ||
          databaseJob?.status !== JOB_STATUS.PROCESSING ||
          !isStaleScheduleClaim(activeJobClaim))

      if (shouldRestoreActiveClaim) {
        await restoreScheduleClaim(
          schedule.id,
          requestId,
          queueTime,
          activeJobClaim,
          `Failed to restore schedule ${schedule.id} claim for active schedule execution job`
        )
      }
      return
    }
    if (existingJob) {
      logger.info(`[${requestId}] Releasing stale schedule claim for finished job`, {
        scheduleId: schedule.id,
        jobId: scheduleJobId,
        status: existingJob.status,
      })
      await releaseScheduleLock(
        schedule.id,
        requestId,
        queuedAt,
        `Released stale schedule ${schedule.id} for finished job ${scheduleJobId}`,
        getNextRunFromCronExpression(schedule.cronExpression, schedule.timezone),
        { expectedLastQueuedAt: queueTime }
      )
      return
    }

    let jobId: string
    try {
      jobId = await jobQueue.enqueue(SCHEDULE_EXECUTION_QUEUE_NAME, payload, {
        jobId: scheduleJobId,
        delayMs,
        metadata: {
          workflowId: schedule.workflowId ?? undefined,
          workspaceId: schedule.workspaceId ?? undefined,
          correlation,
        },
      })
      enqueuedJobId = jobId
    } catch (error) {
      logger.error(
        `[${requestId}] Failed to enqueue schedule execution for workflow ${schedule.workflowId}`,
        error
      )
      await handleClaimedScheduleSetupFailure(
        schedule,
        requestId,
        queueTime,
        error,
        `Failed to defer schedule ${schedule.id} after enqueue failure`,
        `Failed to mark schedule ${schedule.id} failed after non-retryable enqueue failure`
      )
      return
    }

    logger.info(
      `[${requestId}] Queued schedule execution task ${jobId} for workflow ${schedule.workflowId}`
    )

    if (useDatabaseFallback) {
      logger.info(`[${requestId}] Executing durable database schedule execution job`, {
        scheduleId: schedule.id,
        workflowId: schedule.workflowId,
        jobId,
        delayMs,
        concurrencyLimit: SCHEDULE_EXECUTION_CONCURRENCY_LIMIT,
      })
      await executeDatabaseScheduleJob(
        jobQueue,
        jobId,
        payload,
        schedule,
        queueTime,
        requestId,
        delayMs
      )
      return
    }

    const queuedJob = await jobQueue.getJob(jobId)
    if (queuedJob && !['pending', 'processing'].includes(queuedJob.status)) {
      logger.info(`[${requestId}] Schedule execution job already finished`, {
        scheduleId: schedule.id,
        jobId,
        status: queuedJob.status,
      })
      await releaseScheduleLock(
        schedule.id,
        requestId,
        queuedAt,
        `Released stale schedule ${schedule.id} for finished job ${jobId}`,
        getNextRunFromCronExpression(schedule.cronExpression, schedule.timezone),
        { expectedLastQueuedAt: queueTime }
      )
      return
    }
    if (queuedJob) {
      const queuedJobClaim = getSchedulePayloadClaimedAt(getSchedulePayloadFromJob(queuedJob))
      if (queuedJobClaim) {
        if (isStaleScheduleClaim(queuedJobClaim)) {
          logger.warn(`[${requestId}] Cancelling stale queued schedule execution job`, {
            scheduleId: schedule.id,
            jobId,
            claimedAt: queuedJobClaim.toISOString(),
          })
          await jobQueue.cancelJob(jobId)
          await releaseScheduleLock(
            schedule.id,
            requestId,
            queuedAt,
            `Released stale schedule ${schedule.id} after cancelling stale queued schedule execution job`,
            undefined,
            { expectedLastQueuedAt: queueTime }
          )
          return
        }

        await restoreScheduleClaim(
          schedule.id,
          requestId,
          queueTime,
          queuedJobClaim,
          `Failed to restore schedule ${schedule.id} claim for queued schedule execution job`
        )
      }
    }

    logger.info(`[${requestId}] Schedule execution task accepted`, {
      scheduleId: schedule.id,
      workflowId: schedule.workflowId,
      jobId,
      delayMs,
      concurrencyLimit: SCHEDULE_EXECUTION_CONCURRENCY_LIMIT,
      backend: useDatabaseFallback ? 'database-fallback' : 'trigger-dev',
    })
  } catch (error) {
    logger.error(
      `[${requestId}] Failed after queueing schedule execution for workflow ${schedule.workflowId}`,
      error
    )
    if (!enqueuedJobId) {
      await handleClaimedScheduleSetupFailure(
        schedule,
        requestId,
        queueTime,
        error,
        `Failed to defer schedule ${schedule.id} after pre-enqueue failure`,
        `Failed to mark schedule ${schedule.id} failed after non-retryable setup failure`
      )
    }
  }
}

async function processJobItem(job: ClaimedJob, queuedAt: Date, requestId: string) {
  const queueTime = job.lastQueuedAt ?? queuedAt
  const payload = {
    scheduleId: job.id,
    cronExpression: job.cronExpression || undefined,
    failedCount: job.failedCount || 0,
    now: queueTime.toISOString(),
  }

  try {
    await executeJobInline(payload)
  } catch (error) {
    logger.error(`[${requestId}] Job execution failed for ${job.id}`, {
      error: toError(error).message,
    })
    await releaseScheduleLock(
      job.id,
      requestId,
      queuedAt,
      `Failed to release lock for job ${job.id}`,
      undefined,
      { expectedLastQueuedAt: queueTime }
    )
  }
}

interface ScheduleTickResult {
  processedCount: number
  totalSchedules: number
  totalJobs: number
}

/**
 * Drains due schedules and jobs, claiming and enqueuing work until the tick
 * budget is exhausted or no more items are due. Runs detached from the HTTP
 * response so the cron caller does not wait; cross-replica safety is provided by
 * the `FOR UPDATE SKIP LOCKED` claim layer, not this function.
 */
export async function runScheduleTick(requestId: string): Promise<ScheduleTickResult> {
  const tickStart = Date.now()

  const jobQueue = await getJobQueue()
  const useDatabaseFallback = shouldExecuteInline()
  let totalSchedules = 0
  let totalJobs = 0
  let iterations = 0
  let remainingWorkflowBudget = SCHEDULE_WORKFLOW_ENQUEUE_LIMIT
  let schedulesExhausted = false
  let jobsExhausted = false

  while (Date.now() - tickStart < MAX_TICK_DURATION_MS) {
    if (schedulesExhausted && jobsExhausted) break
    const queuedAt = new Date()
    let resumedPendingSchedules = 0
    let databaseScheduleSlots = SCHEDULE_EXECUTION_CONCURRENCY_LIMIT

    if (useDatabaseFallback) {
      await recoverStaleDatabaseScheduleJobs(queuedAt)
      databaseScheduleSlots = await getDatabaseScheduleExecutionSlots()
      resumedPendingSchedules = await resumePendingDatabaseScheduleJobs(
        jobQueue,
        requestId,
        databaseScheduleSlots
      )
      databaseScheduleSlots = await getDatabaseScheduleExecutionSlots()
    }

    const workflowClaimLimit = Math.min(
      WORKFLOW_CHUNK_SIZE,
      remainingWorkflowBudget,
      useDatabaseFallback ? databaseScheduleSlots : WORKFLOW_CHUNK_SIZE
    )

    if (useDatabaseFallback && workflowClaimLimit <= 0) {
      schedulesExhausted = true
    }

    const [dueSchedules, dueJobs] = await Promise.all([
      schedulesExhausted ? [] : claimWorkflowSchedules(queuedAt, workflowClaimLimit),
      jobsExhausted ? [] : claimJobSchedules(queuedAt, JOB_CHUNK_SIZE),
    ])

    remainingWorkflowBudget -= dueSchedules.length
    if (dueSchedules.length < workflowClaimLimit || remainingWorkflowBudget <= 0) {
      schedulesExhausted = true
    }
    if (dueJobs.length < JOB_CHUNK_SIZE) jobsExhausted = true

    if (dueSchedules.length === 0 && dueJobs.length === 0 && resumedPendingSchedules === 0) break

    iterations += 1
    totalSchedules += dueSchedules.length + resumedPendingSchedules
    totalJobs += dueJobs.length

    logger.info(
      `[${requestId}] Iteration ${iterations}: claimed ${dueSchedules.length} schedules, resumed ${resumedPendingSchedules} pending schedule jobs, ${dueJobs.length} jobs`,
      {
        remainingWorkflowBudget,
        scheduleConcurrencyLimit: SCHEDULE_EXECUTION_CONCURRENCY_LIMIT,
        databaseScheduleSlots,
      }
    )

    const schedulePromises =
      dueSchedules.length > 0
        ? dueSchedules.map((schedule) =>
            processScheduleItem(schedule, queuedAt, requestId, jobQueue, useDatabaseFallback)
          )
        : []

    await Promise.allSettled([
      ...schedulePromises,
      ...dueJobs.map((job) => processJobItem(job, queuedAt, requestId)),
    ])
  }

  const totalCount = totalSchedules + totalJobs
  const durationMs = Date.now() - tickStart
  logger.info(
    `[${requestId}] Processed ${totalCount} items across ${iterations} iteration(s) in ${durationMs}ms (${totalSchedules} schedules, ${totalJobs} jobs)`,
    {
      scheduleConcurrencyLimit: SCHEDULE_EXECUTION_CONCURRENCY_LIMIT,
      scheduleEnqueueBudget: SCHEDULE_WORKFLOW_ENQUEUE_LIMIT,
      remainingWorkflowBudget,
    }
  )

  return { processedCount: totalCount, totalSchedules, totalJobs }
}

export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  logger.info(`[${requestId}] Scheduled execution triggered at ${new Date().toISOString()}`)

  const authError = verifyCronAuth(request, 'Schedule execution')
  if (authError) {
    return authError
  }

  runDetached('schedule-execution-tick', () => runScheduleTick(requestId))

  const response = {
    message: 'Scheduled execution started',
    status: 'started',
  } satisfies ExecuteSchedulesResponse

  return NextResponse.json(response, { status: 202 })
})
