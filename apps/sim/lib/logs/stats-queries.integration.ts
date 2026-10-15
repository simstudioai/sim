/**
 * Dashboard stats against real PostgreSQL: grouping by `workflow_id` and
 * joining names once per group answers exactly what the read did when it
 * grouped by the name joined on every row — for every filter, for
 * runs whose workflow was deleted or never recorded, and past the
 * `MAX_STATS_WORKFLOWS` cut, whose ties are ordered by name.
 */
import { db } from '@sim/db'
import {
  folder,
  user,
  workflow,
  workflowExecutionLogs,
  workflowExecutionSnapshots,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import { compareStrings } from '@sim/utils/string'
import { and, eq, inArray, type SQL, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MAX_STATS_WORKFLOWS } from '@/lib/api/contracts/logs'
import { buildFilterConditions, type LogFilterParams } from '@/lib/logs/filters'
import { folderScopeCondition, type LogFolderScope } from '@/lib/logs/folder-scope'
import { handledErrorSpanCondition } from '@/lib/logs/handled-errors'
import { buildLogFilters, type LogFilters } from '@/lib/logs/public-filters'
import { buildDashboardStats, type LogStatsWindow } from '@/lib/logs/stats'
import { type LogStatsSegmentRow, readLogStatsSegments } from '@/lib/logs/stats-queries'

const prefix = generateId()
const ids = {
  owner: `log-stats-${prefix}`,
  workspace: generateId(),
  snapshot: generateId(),
  folder: generateId(),
  childFolder: generateId(),
  deletedWorkflow: generateId(),
}
const FOLDER_NAME = `Stats Folder ${prefix}`

/** More live workflows than the cut keeps, so the deleted series pushes it further over. */
const WORKFLOW_COUNT = MAX_STATS_WORKFLOWS + 5
const workflowIds = Array.from({ length: WORKFLOW_COUNT }, () => generateId())
const TRIGGERS = ['api', 'webhook', 'schedule', 'manual'] as const

const SEGMENT_COUNT = 24
const WINDOW: LogStatsWindow = {
  startTime: new Date('2026-01-01T00:00:00.000Z'),
  endTime: new Date('2026-01-02T00:00:00.000Z'),
  segmentMs: 60 * 60 * 1000,
}

function runAt(hour: number, minute: number) {
  return new Date(Date.UTC(2026, 0, 1, hour, minute))
}

/**
 * The read as it stood before it stopped grouping by the joined name: the
 * oracle each case is compared against.
 */
async function readSegmentsBeforeChange(
  where: SQL | undefined,
  countHandledErrors: boolean
): Promise<LogStatsSegmentRow[]> {
  const startTimeIso = WINDOW.startTime.toISOString()
  return db
    .select({
      handledErrorRuns: (countHandledErrors
        ? sql<number>`COUNT(*) FILTER (WHERE ${handledErrorSpanCondition()})`
        : sql<number>`0`
      ).as('handled_error_runs'),
      workflowId: sql<string>`COALESCE(${workflowExecutionLogs.workflowId}, 'deleted')`,
      workflowName: sql<string>`COALESCE(${workflow.name}, 'Deleted Workflow')`,
      segmentIndex:
        sql<number>`FLOOR(EXTRACT(EPOCH FROM (${workflowExecutionLogs.startedAt} - ${startTimeIso}::timestamp)) * 1000 / ${WINDOW.segmentMs})`.as(
          'segment_index'
        ),
      totalExecutions: sql<number>`COUNT(*)`.as('total_executions'),
      successfulExecutions:
        sql<number>`COUNT(*) FILTER (WHERE ${workflowExecutionLogs.level} != 'error')`.as(
          'successful_executions'
        ),
      avgDurationMs:
        sql<number>`COALESCE(AVG(${workflowExecutionLogs.totalDurationMs}) FILTER (WHERE ${workflowExecutionLogs.totalDurationMs} > 0), 0)`.as(
          'avg_duration_ms'
        ),
    })
    .from(workflowExecutionLogs)
    .leftJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
    .where(where)
    .groupBy(
      sql`COALESCE(${workflowExecutionLogs.workflowId}, 'deleted')`,
      sql`COALESCE(${workflow.name}, 'Deleted Workflow')`,
      sql`segment_index`
    )
}

function canonical(rows: LogStatsSegmentRow[]) {
  return [...rows].sort(
    (a, b) =>
      compareStrings(a.workflowId, b.workflowId) || Number(a.segmentIndex) - Number(b.segmentIndex)
  )
}

async function expectSameStats(where: SQL | undefined, countHandledErrors = false) {
  const [before, after] = await Promise.all([
    readSegmentsBeforeChange(where, countHandledErrors),
    readLogStatsSegments(where, WINDOW.startTime.toISOString(), WINDOW.segmentMs, {
      countHandledErrors,
    }),
  ])

  expect(canonical(after)).toEqual(canonical(before))

  const options = { maxWorkflows: MAX_STATS_WORKFLOWS, includeHandledErrors: countHandledErrors }
  const expected = buildDashboardStats(canonical(before), WINDOW, SEGMENT_COUNT, options)
  expect(buildDashboardStats(canonical(after), WINDOW, SEGMENT_COUNT, options)).toEqual(expected)
  expect(buildDashboardStats(canonical(after), WINDOW, SEGMENT_COUNT)).toEqual(
    buildDashboardStats(canonical(before), WINDOW, SEGMENT_COUNT)
  )
  return { before, after }
}

function scopedTo(filters: SQL | undefined) {
  return and(eq(workflowExecutionLogs.workspaceId, ids.workspace), filters)
}

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values({
    id: ids.owner,
    name: 'Log Stats',
    email: `${ids.owner}@log-stats.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await insertWorkspaceFixture(db, {
    id: ids.workspace,
    name: 'Log Stats',
    ownerId: ids.owner,
    billedAccountUserId: ids.owner,
  })
  await db.insert(folder).values([
    {
      id: ids.folder,
      resourceType: 'workflow',
      name: FOLDER_NAME,
      userId: ids.owner,
      workspaceId: ids.workspace,
    },
    {
      id: ids.childFolder,
      resourceType: 'workflow',
      name: `Nested ${prefix}`,
      userId: ids.owner,
      workspaceId: ids.workspace,
      parentId: ids.folder,
    },
  ])

  const folderFor = (index: number) =>
    index % 5 === 0 ? ids.folder : index % 5 === 1 ? ids.childFolder : null
  await db.insert(workflow).values([
    ...workflowIds.map((id, index) => ({
      id,
      userId: ids.owner,
      workspaceId: ids.workspace,
      folderId: folderFor(index),
      name: `Workflow ${String(index).padStart(3, '0')}`,
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
    })),
    {
      id: ids.deletedWorkflow,
      userId: ids.owner,
      workspaceId: ids.workspace,
      folderId: ids.folder,
      name: 'Doomed Workflow',
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
    },
  ])
  await db.insert(workflowExecutionSnapshots).values({
    id: ids.snapshot,
    workflowId: workflowIds[0],
    stateHash: ids.snapshot,
    stateData: {},
  })

  const run = (
    workflowId: string | null,
    n: number,
    level: 'info' | 'error',
    executionData: Record<string, unknown> = {}
  ) => ({
    id: generateId(),
    workflowId,
    workspaceId: ids.workspace,
    executionId: `${prefix}-exec-${generateId()}`,
    stateSnapshotId: ids.snapshot,
    level,
    status: level === 'error' ? 'failed' : 'completed',
    trigger: TRIGGERS[n % TRIGGERS.length],
    startedAt: runAt(n % SEGMENT_COUNT, (n * 7) % 60),
    totalDurationMs: n % 6 === 0 ? null : n % 6 === 1 ? 0 : 100 + n * 13,
    costTotal: String((n % 9) * 0.01),
    executionData,
  })

  /**
   * Most workflows never fail, so the cut falls inside a tie on error rate that
   * only names can order; a few fail, and one run carries a handled error.
   */
  await db
    .insert(workflowExecutionLogs)
    .values([
      ...workflowIds.flatMap((id, index) => [
        run(id, index, 'info', index === 3 ? { hasHandledErrors: true } : {}),
        run(id, index + 11, index % 17 === 0 ? 'error' : 'info'),
        ...(index % 3 === 0 ? [run(id, index + 5, 'info')] : []),
      ]),
      run(ids.deletedWorkflow, 2, 'info'),
      run(ids.deletedWorkflow, 9, 'error'),
      run(null, 4, 'info'),
      run(null, 30, 'error'),
    ])

  await db.delete(workflow).where(eq(workflow.id, ids.deletedWorkflow))
}, 60_000)

afterAll(async () => {
  await db.delete(workflowExecutionLogs).where(eq(workflowExecutionLogs.workspaceId, ids.workspace))
  await db.delete(workflowExecutionSnapshots).where(eq(workflowExecutionSnapshots.id, ids.snapshot))
  await db.delete(workflow).where(inArray(workflow.id, workflowIds))
  await db.delete(folder).where(eq(folder.workspaceId, ids.workspace))
  await deleteWorkspaceFixture(db, eq(workspace.id, ids.workspace))
  await db.delete(user).where(eq(user.id, ids.owner))
})

describe('dashboard stats segments', () => {
  it('keeps runs of deleted and unrecorded workflows in one named series', async () => {
    const { after } = await expectSameStats(scopedTo(undefined))

    const deleted = after.filter((row) => row.workflowId === 'deleted')
    expect(deleted.every((row) => row.workflowName === 'Deleted Workflow')).toBe(true)
    expect(deleted.reduce((sum, row) => sum + Number(row.totalExecutions), 0)).toBe(4)
  })

  it('cuts the per-workflow series at the same workflows, ordered by name inside a tie', async () => {
    const { after } = await expectSameStats(scopedTo(undefined))
    const { stats, workflowsTruncated } = buildDashboardStats(
      canonical(after),
      WINDOW,
      SEGMENT_COUNT,
      { maxWorkflows: MAX_STATS_WORKFLOWS }
    )

    expect(workflowsTruncated).toBe(true)
    expect(stats.workflows).toHaveLength(MAX_STATS_WORKFLOWS)
    expect(stats.workflows.at(-1)?.workflowName).toMatch(/^Workflow \d{3}$/)
  })

  const dashboardCases: Array<[string, Omit<LogFilterParams, 'workspaceId'>]> = [
    ['no filter', {}],
    ['an error level', { level: 'error' }],
    ['an info level', { level: 'info' }],
    ['workflow ids', { workflowIds: workflowIds.slice(0, 4).join(',') }],
    ['folder ids', { folderIds: `${ids.folder},${ids.childFolder}` }],
    ['a workflow name search', { workflowName: 'Workflow 01' }],
    ['a folder name search', { folderName: FOLDER_NAME }],
    ['triggers', { triggers: 'api,webhook' }],
    ['the all-triggers sentinel', { triggers: 'all' }],
    [
      'a date range',
      { startDate: runAt(3, 0).toISOString(), endDate: runAt(15, 30).toISOString() },
    ],
    ['a cost bound', { costOperator: '>=', costValue: 0.04 }],
    ['a duration bound', { durationOperator: '>', durationValue: 500 }],
    ['an execution id search', { search: `${prefix}-exec` }],
    [
      'folder, trigger, level, and date together',
      {
        folderIds: ids.folder,
        triggers: 'api,schedule,manual',
        level: 'info',
        startDate: runAt(1, 0).toISOString(),
      },
    ],
  ]

  it.each(dashboardCases)(
    'answers the dashboard route the same under %s',
    async (_case, params) => {
      const filterParams: LogFilterParams = { ...params, workspaceId: ids.workspace }
      await expectSameStats(
        scopedTo(buildFilterConditions(filterParams, { useSimpleLevelFilter: true }))
      )
    }
  )

  const publicCases: Array<[string, Omit<LogFilters, 'workspaceId'>, LogFolderScope | undefined]> =
    [
      ['no filter', {}, undefined],
      ['workflow ids', { workflowIds: workflowIds.slice(10, 13) }, undefined],
      ['a workflow name', { workflowName: 'workflow 1' }, undefined],
      ['an error level', { level: 'error' }, undefined],
      ['statuses', { statuses: ['failed'] }, undefined],
      ['a cost range', { minCost: 0.02, maxCost: 0.06 }, undefined],
      ['the workspace root', {}, { includesRoot: true, folderIds: [] }],
      ['a folder subtree', {}, { includesRoot: false, folderIds: [ids.folder, ids.childFolder] }],
      ['a folder that matched nothing', {}, { includesRoot: false, folderIds: [] }],
    ]

  it.each(publicCases)(
    'answers the public API the same under %s',
    async (_case, filters, scope) => {
      await expectSameStats(
        and(
          buildLogFilters({ ...filters, workspaceId: ids.workspace }),
          scope ? folderScopeCondition(scope) : undefined
        )
      )
    }
  )

  it('counts handled errors the same', async () => {
    const { after } = await expectSameStats(
      buildLogFilters({ workspaceId: ids.workspace, level: 'error', includeHandledErrors: true }),
      true
    )
    expect(after.reduce((sum, row) => sum + Number(row.handledErrorRuns), 0)).toBe(1)
  })
})
