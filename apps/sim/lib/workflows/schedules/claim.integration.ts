import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { db } from '@sim/db'
import {
  user,
  workflow,
  workflowDeploymentVersion,
  workflowSchedule,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { claimDueWorkflowSchedules } from '@/lib/workflows/schedules/claim'

const ownerId = generateId()
const workspaceId = generateId()
const workflowId = generateId()
const liveVersionId = generateId()

/** Far in the past, so no other suite's schedule is due at this instant. */
const occurrence = new Date('2001-01-01T00:00:00.000Z')
const queuedAt = new Date('2001-01-01T01:00:00.000Z')
const minutesBefore = (instant: Date, minutes: number) =>
  new Date(instant.getTime() - minutes * 60_000)

/** One schedule per claim state the tick has to tell apart. */
const scheduleIds = {
  unclaimed: generateId(),
  claimedForEarlierOccurrence: generateId(),
  claimHeldPastRecheck: generateId(),
  claimInFlight: generateId(),
  claimRecheckedRecently: generateId(),
  notYetDue: generateId(),
}

const checks: { name: string; status: string; durationMs: number; error?: string }[] = []

function check(name: string, run: () => Promise<void>) {
  it(name, async () => {
    const started = performance.now()
    try {
      await run()
      checks.push({ name, status: 'passed', durationMs: performance.now() - started })
    } catch (error) {
      checks.push({
        name,
        status: 'failed',
        durationMs: performance.now() - started,
        error: getErrorMessage(error),
      })
      throw error
    }
  })
}

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values({
    id: ownerId,
    name: 'Schedule claim fixture',
    email: `${ownerId}@schedule-claim.invalid`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    ownerId,
    billedAccountUserId: ownerId,
    name: 'Schedule claim',
  })
  await db.insert(workflow).values({
    id: workflowId,
    workspaceId,
    userId: ownerId,
    name: 'Schedule claim fixture',
    isDeployed: true,
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(workflowDeploymentVersion).values({
    id: liveVersionId,
    workflowId,
    version: 1,
    isActive: true,
    state: { blocks: {}, edges: [], loops: {}, parallels: {} },
  })

  const schedule = (
    id: string,
    nextRunAt: Date,
    lastQueuedAt: Date | null,
    updatedAt = minutesBefore(queuedAt, 2)
  ) => ({
    id,
    workflowId,
    deploymentVersionId: liveVersionId,
    blockId: id,
    triggerType: 'schedule',
    cronExpression: '*/5 * * * *',
    timezone: 'UTC',
    status: 'active',
    failedCount: 0,
    nextRunAt,
    lastQueuedAt,
    createdAt: occurrence,
    updatedAt,
  })
  await db
    .insert(workflowSchedule)
    .values([
      schedule(scheduleIds.unclaimed, occurrence, null),
      schedule(scheduleIds.claimedForEarlierOccurrence, occurrence, minutesBefore(occurrence, 5)),
      schedule(
        scheduleIds.claimHeldPastRecheck,
        occurrence,
        minutesBefore(queuedAt, 11),
        minutesBefore(queuedAt, 11)
      ),
      schedule(scheduleIds.claimInFlight, occurrence, minutesBefore(queuedAt, 2)),
      schedule(scheduleIds.claimRecheckedRecently, occurrence, minutesBefore(queuedAt, 30)),
      schedule(scheduleIds.notYetDue, minutesBefore(queuedAt, -1), null),
    ])
})

afterAll(async () => {
  const reportPath =
    process.env.SCHEDULE_CLAIM_REPORT_PATH ?? resolve('test-results/schedule-claim.json')
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
  await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
  await db.delete(user).where(eq(user.id, ownerId))
})

check(
  'claims due schedules and re-examines a stale current-occurrence claim without replacing it',
  async () => {
    const claimed = await claimDueWorkflowSchedules(queuedAt, 100)
    const claimById = new Map(
      claimed.filter((row) => row.workflowId === workflowId).map((row) => [row.id, row])
    )

    expect([...claimById.keys()].sort()).toEqual(
      [
        scheduleIds.unclaimed,
        scheduleIds.claimedForEarlierOccurrence,
        scheduleIds.claimHeldPastRecheck,
      ].sort()
    )
    expect(claimById.get(scheduleIds.unclaimed)?.lastQueuedAt).toEqual(queuedAt)
    expect(claimById.get(scheduleIds.claimedForEarlierOccurrence)?.lastQueuedAt).toEqual(queuedAt)
    expect(claimById.get(scheduleIds.claimHeldPastRecheck)?.lastQueuedAt).toEqual(
      minutesBefore(queuedAt, 11)
    )

    const rows = await db
      .select({
        id: workflowSchedule.id,
        lastQueuedAt: workflowSchedule.lastQueuedAt,
        updatedAt: workflowSchedule.updatedAt,
      })
      .from(workflowSchedule)
      .where(inArray(workflowSchedule.id, Object.values(scheduleIds)))
    const stored = new Map(rows.map((row) => [row.id, row]))

    expect(stored.get(scheduleIds.claimHeldPastRecheck)?.updatedAt).toEqual(queuedAt)
    expect(stored.get(scheduleIds.claimInFlight)).toMatchObject({
      lastQueuedAt: minutesBefore(queuedAt, 2),
      updatedAt: minutesBefore(queuedAt, 2),
    })
    expect(stored.get(scheduleIds.claimRecheckedRecently)).toMatchObject({
      lastQueuedAt: minutesBefore(queuedAt, 30),
      updatedAt: minutesBefore(queuedAt, 2),
    })
  }
)
