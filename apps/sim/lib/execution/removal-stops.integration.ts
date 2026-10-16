/**
 * Removing an account, banning it, or deleting its user row directly stops the workflow runs the
 * removal orphans, against real PostgreSQL and Redis through the production removal paths. A
 * stopped execution is one whose cancellation flag, the one its engine watches, is set in Redis;
 * a stopped queued job is a cancelled `async_jobs` row (the database queue these suites run on).
 */
import { authMock } from '@sim/testing/mocks/auth.mock'
import { afterAll, describe, expect, it, vi } from 'vitest'

const { redisUrl, inheritedRedisUrl } = await vi.hoisted(async () => {
  const { readTestRedisUrl } = await import('@sim/db/testing/test-infrastructure')
  const url = readTestRedisUrl()
  const inheritedRedisUrl = process.env.REDIS_URL
  if (url) process.env.REDIS_URL = url
  return { redisUrl: url, inheritedRedisUrl }
})

vi.mock('@/lib/auth', () => authMock)

import { db } from '@sim/db'
import {
  asyncJobs,
  outboxEvent,
  pausedExecutions,
  permissions,
  resumeQueue,
  user,
  workflow,
  workflowExecutionLogs,
  workflowExecutionSnapshots,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { closeRedisConnection, getRedisClient } from '@/lib/core/config/redis'
import { processOutboxEventById } from '@/lib/core/outbox/service'
import { EXECUTION_REMOVAL_STOP_EVENT } from '@/lib/execution/removal-stop-event'
import {
  collectAccountRemovalStops,
  enqueueExecutionStops,
  signalExecutionStops,
} from '@/lib/execution/removal-stop-records'
import { executionRemovalStopOutboxHandlers } from '@/lib/execution/removal-stops'
import { deleteUserAccount } from '@/lib/users/account-deletion'
import { disableUserResources } from '@/lib/workflows/lifecycle'

const userIds: string[] = []
const workspaceIds: string[] = []
const snapshotIds: string[] = []
const executionIds: string[] = []
const jobIds: string[] = []

async function seedUser() {
  const id = generateId()
  userIds.push(id)
  const now = new Date()
  await db.insert(user).values({
    id,
    name: 'Execution removal fixture',
    email: `${id}@execution-removal.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  return id
}

async function seedWorkspace(ownerId: string, writers: string[] = []) {
  const id = generateId()
  workspaceIds.push(id)
  await insertWorkspaceFixture(db, {
    id,
    name: 'Execution removal fixture',
    ownerId,
    billedAccountUserId: ownerId,
  })
  await db.insert(permissions).values(
    [ownerId, ...writers].map((userId) => ({
      id: generateId(),
      userId,
      entityType: 'workspace',
      entityId: id,
      permissionType: userId === ownerId ? ('admin' as const) : ('write' as const),
    }))
  )
  return id
}

async function seedWorkflow(userId: string, workspaceId: string) {
  const id = generateId()
  const now = new Date()
  await db.insert(workflow).values({
    id,
    userId,
    workspaceId,
    name: `Execution removal fixture ${id}`,
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
  return id
}

/** A run whose engine is still executing: its log row says `running`. */
async function seedExecution(
  workspaceId: string,
  workflowId: string,
  status: 'running' | 'pending' = 'running'
) {
  const snapshotId = generateId()
  snapshotIds.push(snapshotId)
  await db.insert(workflowExecutionSnapshots).values({
    id: snapshotId,
    workflowId,
    stateHash: snapshotId,
    stateData: {},
  })
  const executionId = generateId()
  executionIds.push(executionId)
  await db.insert(workflowExecutionLogs).values({
    id: generateId(),
    workflowId,
    workspaceId,
    executionId,
    stateSnapshotId: snapshotId,
    level: 'info',
    status,
    trigger: 'manual',
    startedAt: new Date(),
    executionData: {},
  })
  return executionId
}

/** A paused run whose resume a worker has claimed and is executing under its own id. */
async function seedActiveResume(workspaceId: string, workflowId: string) {
  const parentExecutionId = await seedExecution(workspaceId, workflowId, 'pending')
  const pausedExecutionId = generateId()
  await db.insert(pausedExecutions).values({
    id: pausedExecutionId,
    workflowId,
    executionId: parentExecutionId,
    executionSnapshot: {},
    pausePoints: {},
    totalPauseCount: 1,
    status: 'paused',
  })
  const resumeExecutionId = generateId()
  executionIds.push(resumeExecutionId)
  await db.insert(resumeQueue).values({
    id: generateId(),
    pausedExecutionId,
    parentExecutionId,
    newExecutionId: resumeExecutionId,
    contextId: generateId(),
    status: 'claimed',
  })
  return resumeExecutionId
}

/** A job the queue has not started yet. */
async function seedQueuedJob(workspaceId: string, type = 'webhook-execution') {
  const id = `run_${generateId()}`
  jobIds.push(id)
  await db.insert(asyncJobs).values({
    id,
    type,
    payload: {},
    status: 'pending',
    metadata: { workspaceId },
  })
  return id
}

async function isCancelled(executionId: string) {
  return (await getRedisClient()?.exists(`execution:cancel:${executionId}`)) === 1
}

async function jobStatus(jobId: string) {
  const [row] = await db
    .select({ status: asyncJobs.status })
    .from(asyncJobs)
    .where(eq(asyncJobs.id, jobId))
  return row?.status
}

/** Every stop event naming one of this test's executions or workspaces. */
async function stopEvents(ids: string[]) {
  const rows = await db
    .select({ id: outboxEvent.id, status: outboxEvent.status, payload: outboxEvent.payload })
    .from(outboxEvent)
    .where(eq(outboxEvent.eventType, EXECUTION_REMOVAL_STOP_EVENT))
  return rows.filter((row) => ids.some((id) => JSON.stringify(row.payload).includes(id)))
}

/** Processes the stop events the way the outbox worker does. */
async function runOutboxWorker(eventIds: string[]) {
  for (const eventId of eventIds) {
    await processOutboxEventById(eventId, executionRemovalStopOutboxHandlers)
  }
}

afterAll(async () => {
  if (inheritedRedisUrl === undefined) Reflect.deleteProperty(process.env, 'REDIS_URL')
  else process.env.REDIS_URL = inheritedRedisUrl
})

describe.runIf(Boolean(redisUrl))('removals stop the workflow runs they orphan', () => {
  afterAll(async () => {
    const redis = getRedisClient()
    if (redis && executionIds.length > 0) {
      await redis.del(...executionIds.map((id) => `execution:cancel:${id}`))
    }
    const scoped = [...executionIds, ...workspaceIds]
    for (const id of scoped) {
      await db
        .delete(outboxEvent)
        .where(
          and(
            eq(outboxEvent.eventType, EXECUTION_REMOVAL_STOP_EVENT),
            sql`${outboxEvent.payload}::text like ${`%${id}%`}`
          )
        )
    }
    if (jobIds.length) await db.delete(asyncJobs).where(inArray(asyncJobs.id, jobIds))
    if (executionIds.length) {
      await db
        .delete(workflowExecutionLogs)
        .where(inArray(workflowExecutionLogs.executionId, executionIds))
    }
    if (snapshotIds.length) {
      await db
        .delete(workflowExecutionSnapshots)
        .where(inArray(workflowExecutionSnapshots.id, snapshotIds))
    }
    if (workspaceIds.length) await deleteWorkspaceFixture(db, inArray(workspace.id, workspaceIds))
    if (userIds.length) {
      await db.delete(permissions).where(inArray(permissions.userId, userIds))
      await db.delete(user).where(inArray(user.id, userIds))
    }
    await closeRedisConnection()
  })

  it('stops the running, resuming and queued runs of an erased account’s workspaces, and no one else’s', async () => {
    const departingId = await seedUser()
    const bystanderId = await seedUser()
    const doomedWorkspaceId = await seedWorkspace(departingId)
    const doomedWorkflowId = await seedWorkflow(departingId, doomedWorkspaceId)
    const running = await seedExecution(doomedWorkspaceId, doomedWorkflowId)
    const resuming = await seedActiveResume(doomedWorkspaceId, doomedWorkflowId)
    const queued = await seedQueuedJob(doomedWorkspaceId)
    const unrelatedJob = await seedQueuedJob(doomedWorkspaceId, 'cleanup-logs')
    const keptWorkspaceId = await seedWorkspace(bystanderId)
    const keptRunning = await seedExecution(
      keptWorkspaceId,
      await seedWorkflow(bystanderId, keptWorkspaceId)
    )
    const keptQueued = await seedQueuedJob(keptWorkspaceId)

    await deleteUserAccount(departingId)

    await expect.poll(() => isCancelled(running)).toBe(true)
    await expect.poll(() => isCancelled(resuming)).toBe(true)
    const recorded = await stopEvents([doomedWorkspaceId])
    expect(recorded.map((event) => event.status)).toEqual(['pending'])

    await runOutboxWorker(recorded.map((event) => event.id))

    expect(await jobStatus(queued)).toBe('cancelled')
    expect(await jobStatus(unrelatedJob)).toBe('pending')
    expect((await stopEvents([doomedWorkspaceId])).map((event) => event.status)).toEqual([
      'completed',
    ])
    expect(await isCancelled(keptRunning)).toBe(false)
    expect(await jobStatus(keptQueued)).toBe('pending')
  })

  it('stops a banned owner’s running runs at once and leaves its queued runs to the outbox worker', async () => {
    const bannedId = await seedUser()
    const bystanderId = await seedUser()
    const ownedWorkspaceId = await seedWorkspace(bannedId)
    const running = await seedExecution(
      ownedWorkspaceId,
      await seedWorkflow(bannedId, ownedWorkspaceId)
    )
    const queued = await seedQueuedJob(ownedWorkspaceId)
    const keptWorkspaceId = await seedWorkspace(bystanderId, [bannedId])
    const keptRunning = await seedExecution(
      keptWorkspaceId,
      await seedWorkflow(bystanderId, keptWorkspaceId)
    )
    const keptQueued = await seedQueuedJob(keptWorkspaceId)

    await disableUserResources(bannedId)

    const [archived] = await db
      .select({ archivedAt: workspace.archivedAt })
      .from(workspace)
      .where(eq(workspace.id, ownedWorkspaceId))
    expect(archived.archivedAt).not.toBeNull()
    expect(await isCancelled(running)).toBe(true)
    expect(await isCancelled(keptRunning)).toBe(false)
    const recorded = await stopEvents([ownedWorkspaceId])
    expect(recorded.map((event) => event.status)).toEqual(['pending'])

    await runOutboxWorker(recorded.map((event) => event.id))

    expect(await jobStatus(queued)).toBe('cancelled')
    expect(await jobStatus(keptQueued)).toBe('pending')
  })

  /**
   * Mirrors the Better Auth user delete hooks around `/admin/remove-user`: read before the bare
   * delete, enqueued and signalled once it has committed.
   */
  it('stops the runs of workflows a directly deleted user created in someone else’s workspace', async () => {
    const removedId = await seedUser()
    const bystanderId = await seedUser()
    const sharedWorkspaceId = await seedWorkspace(bystanderId, [removedId])
    const removedUsersRun = await seedExecution(
      sharedWorkspaceId,
      await seedWorkflow(removedId, sharedWorkspaceId)
    )
    const bystandersRun = await seedExecution(
      sharedWorkspaceId,
      await seedWorkflow(bystanderId, sharedWorkspaceId)
    )
    const bystandersQueued = await seedQueuedJob(sharedWorkspaceId)

    const plan = await collectAccountRemovalStops(db, removedId)
    await db.delete(user).where(eq(user.id, removedId))
    const eventIds = await enqueueExecutionStops(db, plan)
    await signalExecutionStops(plan.executions)

    expect(await isCancelled(removedUsersRun)).toBe(true)
    expect(await isCancelled(bystandersRun)).toBe(false)

    await runOutboxWorker(eventIds)

    expect(await jobStatus(bystandersQueued)).toBe('pending')
    expect((await stopEvents([removedUsersRun])).map((event) => event.status)).toEqual([
      'completed',
    ])
  })
})
