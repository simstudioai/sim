/**
 * What the Home Workspaces probe reads when a workspace has thousands of unanswered time pauses, the
 * shape of a schedule waiting on many runs. Each pause point is a JSON read the planner cannot index
 * or estimate, so a probe with no match reads every live pause of the workspaces it was asked about.
 * The bound this holds is that it reads no more than that: the plan is measured on real PostgreSQL
 * with the schema's own indexes, and a neighbor's pauses are never touched. Written as a plain join
 * under `LIMIT 1`, this reads the whole table instead.
 */
import { db } from '@sim/db'
import { user, workflow, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readReviewAndLastRun } from '@/lib/organizations/home/workspace-activity'

const LIVE_PAUSES = 5_000
const WORKFLOWS_PER_WORKSPACE = 20
const PAUSES_PER_WORKFLOW = LIVE_PAUSES / WORKFLOWS_PER_WORKSPACE
/**
 * The rest of the deployment. In a table this workspace dominates a sequential scan is the right
 * plan, and it would say nothing about the table production has.
 */
const NEIGHBOR_WORKFLOWS = 100
const PAUSES_PER_NEIGHBOR_WORKFLOW = 1_000
/** Each loop of a plan node reports its rows rounded, so a total can only be held this closely. */
const ROUNDING_SLACK = 1.05
/** Far above what this costs, so only a change of plan or a pathological runner can reach it. */
const EXECUTION_CEILING_MS = 5_000

const ownerId = generateId()
const timeOnly = generateId()
const neighbor = generateId()
const oneWaiting = generateId()
const workspaces = [timeOnly, neighbor, oneWaiting]

const timePausePoints = {
  context: {
    contextId: 'context',
    blockId: 'wait',
    response: { data: { resumeAt: '2030-01-01T00:00:00.000Z' } },
    registeredAt: '2026-01-01T00:00:00.000Z',
    resumeStatus: 'paused',
    snapshotReady: true,
    pauseKind: 'time',
    resumeAt: '2030-01-01T00:00:00.000Z',
  },
}
const humanPausePoints = {
  context: { ...timePausePoints.context, blockId: 'approval', pauseKind: 'human', resumeAt: null },
}

const workflowIdsOf = (workspaceId: string) =>
  Array.from(
    { length: workspaceId === neighbor ? NEIGHBOR_WORKFLOWS : WORKFLOWS_PER_WORKSPACE },
    (_, index) => `${workspaceId}-${index}`
  )

/** Inserted in one statement: these are the fixture, not the behavior. */
function insertPauses(workflowId: string, count: number, pausePoints: object) {
  return db.execute(sql`
    insert into paused_executions (
      id, workflow_id, execution_id, execution_snapshot, pause_points, total_pause_count
    )
    select gen_random_uuid()::text, ${workflowId}, gen_random_uuid()::text, '{}'::jsonb,
      ${JSON.stringify(pausePoints)}::jsonb, 1
    from generate_series(1, ${count})
  `)
}

interface PlanNode {
  'Node Type': string
  'Relation Name'?: string
  'Actual Rows': number
  'Actual Loops': number
  'Rows Removed by Filter'?: number
  Plans?: PlanNode[]
}

function collectNodes(node: PlanNode): PlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(collectNodes)]
}

/** The planner's real choice for the real query, with its parameters written in. */
async function measureProbe(workspaceIds: string[]) {
  const { sql: text, params } = readReviewAndLastRun(workspaceIds).toSQL()
  const inlined = text.replace(/\$(\d+)/g, (_, position: string) => {
    const value = params[Number(position) - 1]
    return typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`
  })
  const rows = await db.execute(sql.raw(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${inlined}`))
  const [plan] = (rows[0] as { 'QUERY PLAN': { Plan: PlanNode; 'Execution Time': number }[] })[
    'QUERY PLAN'
  ]
  if (!plan) throw new Error('EXPLAIN returned no plan')
  const pauseReads = collectNodes(plan.Plan).filter(
    (node) => node['Relation Name'] === 'paused_executions'
  )
  return {
    executionMs: plan['Execution Time'],
    scans: pauseReads.map((node) => node['Node Type']),
    rowsRead: pauseReads.reduce(
      (total, node) =>
        total +
        (node['Actual Rows'] + (node['Rows Removed by Filter'] ?? 0)) * node['Actual Loops'],
      0
    ),
  }
}

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values({
    id: ownerId,
    name: 'Workspace activity fixture',
    email: `${ownerId}@workspace-activity.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await insertWorkspaceFixture(
    db,
    workspaces.map((id) => ({
      id,
      name: 'Workspace activity fixture',
      ownerId,
      billedAccountUserId: ownerId,
    }))
  )
  await db.insert(workflow).values(
    workspaces.flatMap((workspaceId) =>
      workflowIdsOf(workspaceId).map((id) => ({
        id,
        workspaceId,
        name: id,
        userId: ownerId,
        lastSynced: now,
        createdAt: now,
        updatedAt: now,
      }))
    )
  )
  for (const workspaceId of workspaces) {
    for (const workflowId of workflowIdsOf(workspaceId)) {
      // Before its time pauses, so a probe that stops at the first match stops right away.
      if (workspaceId === oneWaiting) await insertPauses(workflowId, 1, humanPausePoints)
      await insertPauses(
        workflowId,
        workspaceId === neighbor ? PAUSES_PER_NEIGHBOR_WORKFLOW : PAUSES_PER_WORKFLOW,
        timePausePoints
      )
    }
  }
  await db.execute(sql`analyze paused_executions`)
  await db.execute(sql`analyze workflow`)
}, 120_000)

afterAll(async () => {
  await deleteWorkspaceFixture(db, inArray(workspace.id, workspaces))
  await db.delete(user).where(eq(user.id, ownerId))
}, 120_000)

describe('the waiting probe under thousands of time pauses', () => {
  it('does not report a time pause as waiting on a person', async () => {
    const [row] = await readReviewAndLastRun([timeOnly])
    expect(row?.waitingWorkflowName).toBeNull()
  }, 30_000)

  it('with no match reads this workspace’s pauses through an index, and nobody else’s', async () => {
    const { rowsRead, scans, executionMs } = await measureProbe([timeOnly])
    expect(rowsRead).toBeGreaterThanOrEqual(LIVE_PAUSES / ROUNDING_SLACK)
    expect(rowsRead).toBeLessThanOrEqual(LIVE_PAUSES * ROUNDING_SLACK)
    expect(scans).not.toContain('Seq Scan')
    expect(executionMs).toBeLessThan(EXECUTION_CEILING_MS)
  }, 30_000)

  it('stops at the first pause waiting on a person', async () => {
    const [row] = await readReviewAndLastRun([oneWaiting])
    expect(row?.waitingWorkflowName).not.toBeNull()

    const { rowsRead } = await measureProbe([oneWaiting])
    expect(rowsRead).toBeLessThanOrEqual(PAUSES_PER_WORKFLOW * ROUNDING_SLACK)
  }, 30_000)

  it('costs each workspace only its own pauses when asked about several', async () => {
    const { rowsRead } = await measureProbe([timeOnly, oneWaiting])
    expect(rowsRead).toBeLessThanOrEqual((LIVE_PAUSES + PAUSES_PER_WORKFLOW) * ROUNDING_SLACK)
  }, 30_000)
})
