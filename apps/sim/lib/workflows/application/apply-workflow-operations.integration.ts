/**
 * Real PostgreSQL coverage for the conflict guard in `applyWorkflowOperations`:
 * the batch is applied to a graph read without the workflow row lock, and the
 * write re-reads that graph under the lock and refuses when it changed.
 *
 * Interleavings are forced with the row lock itself rather than with timing: a
 * test transaction holds the workflow row, waits until the applies are blocked
 * on it (so their base reads are done), and only then writes or releases.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { db, runOutsideTransactionContext } from '@sim/db'
import { auditLog, permissions, user, workflow, workflowBlocks, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { featureFlagsMock } from '@sim/testing/mocks/feature-flags.mock'
import { realtimeNotifyMock } from '@sim/testing/mocks/realtime-notify.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { saveWorkflowToNormalizedTables } from '@sim/workflow-persistence/save'
import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import type { DbOrTx } from '@/lib/db/types'
import { withPermissionGroupScope } from '@/lib/permission-groups/request-scope.server'
import { applyWorkflowOperations } from '@/lib/workflows/application/apply-workflow-operations'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)

const ownerId = generateId()
const workspaceId = generateId()
const principal = createSessionPrincipal({ userId: ownerId, sessionId: generateId() })

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

function block(
  id: string,
  type: string,
  name: string,
  subBlocks: BlockState['subBlocks'] = {},
  data: BlockState['data'] = {}
): BlockState {
  return { id, type, name, position: { x: 0, y: 0 }, subBlocks, outputs: {}, enabled: true, data }
}

/**
 * A start block wired to a loop and a parallel that each hold a child. With
 * `legacy`, also a Slack block carrying a retired sub-block (`channelMaxPages`)
 * that every load migrates away and persists back in the background.
 */
function seededState(legacy = false): WorkflowState {
  const start = generateId()
  const loop = generateId()
  const parallel = generateId()
  const childCode: BlockState['subBlocks'] = {
    code: { id: 'code', type: 'code', value: 'return 1' },
  }
  const blocks = [
    block(start, 'starter', 'Start'),
    block(loop, 'loop', 'Loop', {}, { loopType: 'for', count: 2 }),
    block(generateId(), 'function', 'In loop', childCode, { parentId: loop, extent: 'parent' }),
    block(parallel, 'parallel', 'Parallel', {}, { parallelType: 'count', count: 2 }),
    block(generateId(), 'function', 'In parallel', childCode, {
      parentId: parallel,
      extent: 'parent',
    }),
  ]
  if (legacy) {
    blocks.push(
      block(generateId(), 'slack', 'Legacy Slack', {
        channelMaxPages: { id: 'channelMaxPages', type: 'short-input', value: '3' },
      })
    )
  }
  return {
    blocks: Object.fromEntries(blocks.map((entry) => [entry.id, entry])),
    edges: [{ id: generateId(), source: start, target: loop }],
    loops: {},
    parallels: {},
  }
}

async function seedWorkflow(state: WorkflowState): Promise<string> {
  const id = generateId()
  const now = new Date()
  await db.insert(workflow).values({
    id,
    userId: ownerId,
    workspaceId,
    name: `Operations conflict ${id}`,
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
  const saved = await saveWorkflowToNormalizedTables(id, state)
  if (!saved.success) throw new Error(`Seeding the workflow failed: ${saved.error}`)
  return id
}

/** Runs inside a permission-group scope, as every route handler does. */
function addBlock(workflowId: string, name: string) {
  return withPermissionGroupScope(() =>
    applyWorkflowOperations.execute({
      principal,
      input: {
        workflowId,
        operations: [
          { operation_type: 'add', block_id: generateId(), params: { type: 'agent', name } },
        ],
      },
    })
  )
}

type Outcome = { ok: true } | { ok: false; error: unknown }

interface PendingApply {
  outcome: Promise<Outcome>
  /** The outcome once settled, so a waiter can report it without awaiting the others. */
  settled: () => Outcome | undefined
}

/**
 * Starts an apply on its own connection. Called from inside the lock holder's
 * transaction callback, so it leaves that transaction's context; otherwise it
 * would count as a second query of the holder's transaction.
 */
function startApply(workflowId: string, name: string): PendingApply {
  let result: Outcome | undefined
  const outcome = runOutsideTransactionContext(() =>
    addBlock(workflowId, name).then(
      (): Outcome => (result = { ok: true }),
      (error: unknown): Outcome => (result = { ok: false, error })
    )
  )
  return { outcome, settled: () => result }
}

/**
 * Holds the workflow row lock for the duration of `run`, handing it the
 * holder's backend pid so it can wait for sessions queued behind the lock.
 */
async function whileRowLocked(
  workflowId: string,
  run: (tx: DbOrTx, holderPid: number) => Promise<void>
): Promise<void> {
  await db.transaction(async (tx) => {
    const [self] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
    await tx
      .select({ id: workflow.id })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .for('update')
    await run(tx, Number(self?.pid))
  })
}

/**
 * Waits until `count` sessions are queued behind the holder, directly or
 * behind another waiter. Throws as soon as an apply settles first, reporting
 * only the settled ones: the rest are queued on the lock this caller holds, so
 * awaiting them would hang.
 */
function waitForBlocked(holderPid: number, count: number, applies: PendingApply[]): Promise<void> {
  return runOutsideTransactionContext(async () => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const early = applies.flatMap((apply) => apply.settled() ?? [])
      if (early.length > 0) {
        throw new Error(
          `An apply finished before reaching the row lock: ${early
            .map((outcome) => (outcome.ok ? 'committed' : getErrorMessage(outcome.error)))
            .join('; ')}`
        )
      }
      // Followers queue behind the first waiter's tuple lock, not the holder, so walk the chain.
      const [row] = await db.execute<{ blocked: number }>(sql`
        WITH RECURSIVE queued(pid) AS (
          SELECT pid FROM pg_stat_activity WHERE ${holderPid} = ANY(pg_blocking_pids(pid))
          UNION
          SELECT activity.pid FROM pg_stat_activity activity
          JOIN queued ON queued.pid = ANY(pg_blocking_pids(activity.pid))
        )
        SELECT count(*)::int AS blocked FROM queued`)
      if ((row?.blocked ?? 0) >= count) return
      await sleep(25)
    }
    throw new Error(`Expected ${count} session(s) blocked behind backend ${holderPid}`)
  })
}

async function storedBlockNames(workflowId: string): Promise<string[]> {
  const rows = await db
    .select({ name: workflowBlocks.name })
    .from(workflowBlocks)
    .where(eq(workflowBlocks.workflowId, workflowId))
  return rows.map((row) => row.name).sort()
}

function expectConflict(outcome: Outcome) {
  expect(outcome.ok).toBe(false)
  if (!outcome.ok) expect(outcome.error).toMatchObject({ code: 'conflict' })
}

const SEEDED_NAMES = ['In loop', 'In parallel', 'Loop', 'Parallel', 'Start']

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values({
    id: ownerId,
    name: 'Operations conflict fixture',
    email: `${ownerId}@operations-conflict.invalid`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    name: 'Operations conflict',
    ownerId,
    billedAccountUserId: ownerId,
  })
  await db.insert(permissions).values({
    id: generateId(),
    userId: ownerId,
    entityType: 'workspace',
    entityId: workspaceId,
    permissionType: 'admin',
  })
})

afterAll(async () => {
  const reportPath =
    process.env.WORKFLOW_OPERATIONS_CONFLICT_REPORT_PATH ??
    resolve('test-results/workflow-operations-conflict.json')
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
  await db.delete(auditLog).where(eq(auditLog.workspaceId, workspaceId))
  await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
  await db.delete(user).where(eq(user.id, ownerId))
})

check('commits on an unchanged workflow with containers and a migrated block', async () => {
  const workflowId = await seedWorkflow(seededState(true))

  const result = await addBlock(workflowId, 'Triage')

  expect(result.dryRun).toBe(false)
  expect(await storedBlockNames(workflowId)).toEqual(
    [...SEEDED_NAMES, 'Legacy Slack', 'Triage'].sort()
  )
})

check('refuses a write when the workflow changed after the base read', async () => {
  const seeded = seededState()
  const workflowId = await seedWorkflow(seeded)
  const concurrent = generateId()
  let apply!: PendingApply

  await whileRowLocked(workflowId, async (tx, holderPid) => {
    apply = startApply(workflowId, 'Stale edit')
    await waitForBlocked(holderPid, 1, [apply])
    const saved = await saveWorkflowToNormalizedTables(
      workflowId,
      {
        ...seeded,
        blocks: { ...seeded.blocks, [concurrent]: block(concurrent, 'function', 'Concurrent') },
      },
      tx
    )
    if (!saved.success) throw new Error(`The concurrent write failed: ${saved.error}`)
  })

  expectConflict(await apply.outcome)
  expect(await storedBlockNames(workflowId)).toEqual([...SEEDED_NAMES, 'Concurrent'].sort())
})

check('lets one of two concurrent applies commit and refuses the other', async () => {
  const workflowId = await seedWorkflow(seededState())
  let applies: PendingApply[] = []

  await whileRowLocked(workflowId, async (_tx, holderPid) => {
    applies = [startApply(workflowId, 'First'), startApply(workflowId, 'Second')]
    await waitForBlocked(holderPid, 2, applies)
  })

  const [first, second] = await Promise.all(applies.map((apply) => apply.outcome))
  expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1)
  expectConflict(first.ok ? second : first)
  const winner = first.ok ? 'First' : 'Second'
  expect(await storedBlockNames(workflowId)).toEqual([...SEEDED_NAMES, winner].sort())
})
