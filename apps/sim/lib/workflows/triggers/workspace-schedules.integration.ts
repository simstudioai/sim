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
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { CursorKey, ListSortOrder } from '@/lib/api/list-query'
import {
  listLiveWorkflowTriggers,
  listWorkspaceLiveSchedulesPage,
  toWorkflowTriggerHealth,
  type WorkspaceScheduleRecord,
} from '@/lib/workflows/triggers/health'

const ownerId = generateId()
const workspaceId = generateId()
const otherWorkspaceId = generateId()

const liveWorkflowId = generateId()
const secondLiveWorkflowId = generateId()
const archivedWorkflowId = generateId()
const undeployedWorkflowId = generateId()
const foreignWorkflowId = generateId()

const oldVersionId = generateId()
const liveVersionId = generateId()
const secondLiveVersionId = generateId()
const archivedVersionId = generateId()
const undeployedVersionId = generateId()
const foreignVersionId = generateId()

/** Five of the six live schedules share this instant, so every page boundary falls inside a tie. */
const tiedCreatedAt = new Date('2026-01-01T00:00:00.000Z')
const laterCreatedAt = new Date('2026-02-01T00:00:00.000Z')

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

function scheduleKey(record: WorkspaceScheduleRecord): string {
  return `${record.workflowId}:${record.health.blockId}`
}

async function listAll(sortOrder: ListSortOrder, limit: number) {
  const records: WorkspaceScheduleRecord[] = []
  let cursorKeys: CursorKey[] | undefined
  for (let page = 0; page < 20; page++) {
    const result = await listWorkspaceLiveSchedulesPage({
      workspaceId,
      sortBy: 'createdAt',
      sortOrder,
      limit,
      cursorKeys,
    })
    records.push(...result.data)
    if (!result.nextCursorKeys) return records
    cursorKeys = result.nextCursorKeys
  }
  throw new Error('Pagination did not terminate')
}

beforeAll(async () => {
  const now = new Date()
  const emptyState = { blocks: {}, edges: [], loops: {}, parallels: {} }
  await db.insert(user).values({
    id: ownerId,
    name: 'Workspace schedules fixture',
    email: `${ownerId}@workspace-schedules.invalid`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await insertWorkspaceFixture(db, [
    { id: workspaceId, ownerId, billedAccountUserId: ownerId, name: 'Workspace schedules' },
    {
      id: otherWorkspaceId,
      ownerId,
      billedAccountUserId: ownerId,
      name: 'Workspace schedules elsewhere',
    },
  ])
  await db.insert(workflow).values(
    [
      { id: liveWorkflowId, workspaceId, isDeployed: true, archivedAt: null },
      { id: secondLiveWorkflowId, workspaceId, isDeployed: true, archivedAt: null },
      { id: archivedWorkflowId, workspaceId, isDeployed: true, archivedAt: now },
      { id: undeployedWorkflowId, workspaceId, isDeployed: false, archivedAt: null },
      {
        id: foreignWorkflowId,
        workspaceId: otherWorkspaceId,
        isDeployed: true,
        archivedAt: null,
      },
    ].map((row, index) => ({
      ...row,
      userId: ownerId,
      name: `Workspace schedules fixture ${index}`,
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
    }))
  )
  await db.insert(workflowDeploymentVersion).values(
    [
      { id: oldVersionId, workflowId: liveWorkflowId, version: 1, isActive: false },
      { id: liveVersionId, workflowId: liveWorkflowId, version: 2, isActive: true },
      { id: secondLiveVersionId, workflowId: secondLiveWorkflowId, version: 1, isActive: true },
      { id: archivedVersionId, workflowId: archivedWorkflowId, version: 1, isActive: true },
      { id: undeployedVersionId, workflowId: undeployedWorkflowId, version: 1, isActive: true },
      { id: foreignVersionId, workflowId: foreignWorkflowId, version: 1, isActive: true },
    ].map((row) => ({ ...row, state: emptyState }))
  )

  const schedule = (
    workflowId: string,
    deploymentVersionId: string,
    blockId: string,
    createdAt = tiedCreatedAt
  ) => ({
    id: generateId(),
    workflowId,
    deploymentVersionId,
    blockId,
    triggerType: 'schedule',
    cronExpression: '0 * * * *',
    timezone: 'UTC',
    status: 'active',
    failedCount: 0,
    nextRunAt: laterCreatedAt,
    createdAt,
    updatedAt: createdAt,
  })
  await db
    .insert(workflowSchedule)
    .values([
      schedule(liveWorkflowId, liveVersionId, 'first'),
      schedule(liveWorkflowId, liveVersionId, 'second'),
      schedule(liveWorkflowId, liveVersionId, 'third'),
      schedule(liveWorkflowId, liveVersionId, 'latest', laterCreatedAt),
      schedule(liveWorkflowId, oldVersionId, 'retired'),
      schedule(secondLiveWorkflowId, secondLiveVersionId, 'fourth'),
      schedule(secondLiveWorkflowId, secondLiveVersionId, 'fifth'),
      schedule(archivedWorkflowId, archivedVersionId, 'archived'),
      schedule(undeployedWorkflowId, undeployedVersionId, 'undeployed'),
      schedule(foreignWorkflowId, foreignVersionId, 'foreign'),
    ])
})

afterAll(async () => {
  const reportPath =
    process.env.WORKSPACE_SCHEDULES_REPORT_PATH ?? resolve('test-results/workspace-schedules.json')
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
  await deleteWorkspaceFixture(db, inArray(workspace.id, [workspaceId, otherWorkspaceId]))
  await db.delete(user).where(inArray(user.id, [ownerId]))
})

check('lists the schedules each live workflow reports, and nothing else', async () => {
  const perWorkflow = await Promise.all(
    [liveWorkflowId, secondLiveWorkflowId].map(async (workflowId) =>
      (await listLiveWorkflowTriggers(workflowId))
        .filter((record) => record.table === 'schedule')
        .map((record) => ({ workflowId, health: toWorkflowTriggerHealth(record) }))
    )
  )
  const expected = perWorkflow.flat()
  const listed = await listAll('desc', 50)

  expect(expected).toHaveLength(6)
  expect(listed.map(({ workflowId, health }) => ({ workflowId, health }))).toEqual(
    expect.arrayContaining(expected)
  )
  expect(listed).toHaveLength(expected.length)
})

check('leaves out archived, undeployed, and other-workspace workflows', async () => {
  const workflowIds = new Set((await listAll('desc', 50)).map((record) => record.workflowId))

  expect([...workflowIds].sort()).toEqual([liveWorkflowId, secondLiveWorkflowId].sort())
})

for (const sortOrder of ['desc', 'asc'] as const) {
  check(`pages ${sortOrder} through createdAt ties without repeats or gaps`, async () => {
    const whole = (await listAll(sortOrder, 50)).map(scheduleKey)
    const paged = (await listAll(sortOrder, 2)).map(scheduleKey)

    expect(new Set(paged).size).toBe(paged.length)
    expect(paged).toEqual(whole)
    expect(whole).toHaveLength(6)
    expect(whole[sortOrder === 'desc' ? 0 : whole.length - 1]).toBe(`${liveWorkflowId}:latest`)
  })
}
