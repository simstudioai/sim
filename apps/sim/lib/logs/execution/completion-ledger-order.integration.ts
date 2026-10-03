/**
 * Completion ordering against real PostgreSQL: a run's usage ledger is written before its
 * log reads terminal, so a reader that sees a finished run always sees its cost.
 */
import { db } from '@sim/db'
import {
  usageLog,
  user,
  workflow,
  workflowExecutionLogs,
  workflowExecutionSnapshots,
  workspace,
} from '@sim/db/schema'
import { createDeferred } from '@sim/testing'
import { generateId } from '@sim/utils/id'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { resolveBillingAttribution } from '@/lib/billing/core/billing-attribution'
import { acquireAdvisoryXactLock } from '@/lib/db/advisory-locks'
import { buildCostLedger } from '@/lib/logs/cost-ledger'
import { executionLogger } from '@/lib/logs/execution/logger'
import { calculateCostSummary } from '@/lib/logs/execution/logging-factory'
import type { WorkflowState } from '@/lib/logs/types'

const ids = {
  owner: `ledger-order-owner-${generateId()}`,
  workspace: generateId(),
  workflow: generateId(),
}

/** The advisory lock the usage ledger write takes for its execution before inserting. */
const USAGE_RECONCILE_LOCK = 'execution_usage_reconcile'
const EXECUTION_FEE = 0.005

const workflowState: WorkflowState = {
  blocks: {
    start: {
      id: 'start',
      type: 'starter',
      name: 'Start',
      position: { x: 0, y: 0 },
      subBlocks: {},
      outputs: {},
      enabled: true,
    },
  },
  edges: [],
  loops: {},
  parallels: {},
}

async function startExecution(executionId: string) {
  await executionLogger.startWorkflowExecution({
    workflowId: ids.workflow,
    workspaceId: ids.workspace,
    executionId,
    trigger: { type: 'api', source: 'api', timestamp: new Date().toISOString() },
    environment: {
      variables: {},
      workflowId: ids.workflow,
      executionId,
      userId: ids.owner,
      workspaceId: ids.workspace,
    },
    workflowState,
  })
}

async function logRow(executionId: string) {
  const [row] = await db
    .select({ status: workflowExecutionLogs.status, costTotal: workflowExecutionLogs.costTotal })
    .from(workflowExecutionLogs)
    .where(eq(workflowExecutionLogs.executionId, executionId))
  return row
}

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values({
    id: ids.owner,
    name: 'Ledger Order',
    email: `${ids.owner}@ledger-order.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(workspace).values({
    id: ids.workspace,
    name: 'Ledger Order',
    ownerId: ids.owner,
    billedAccountUserId: ids.owner,
  })
  await db.insert(workflow).values({
    id: ids.workflow,
    userId: ids.owner,
    workspaceId: ids.workspace,
    name: 'Ledger Order',
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
})

afterAll(async () => {
  await db.delete(usageLog).where(eq(usageLog.workflowId, ids.workflow))
  await db.delete(workflowExecutionLogs).where(eq(workflowExecutionLogs.workflowId, ids.workflow))
  await db
    .delete(workflowExecutionSnapshots)
    .where(eq(workflowExecutionSnapshots.workflowId, ids.workflow))
  await db.delete(workspace).where(eq(workspace.id, ids.workspace))
  await db.delete(user).where(eq(user.id, ids.owner))
})

/**
 * Whether a session waits on this execution's ledger lock. A bigint advisory key is stored
 * split across `classid` (high 32 bits) and `objid` (low 32 bits) with `objsubid = 1`.
 */
async function isLedgerLockAwaited(executionId: string) {
  const rows = await db.execute<{ waiting: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_locks
      WHERE locktype = 'advisory' AND NOT granted AND objsubid = 1
        AND ((classid::bigint << 32) | objid::bigint) = hashtextextended(${executionId}, 0)
    ) AS waiting
  `)
  return Boolean(rows[0]?.waiting)
}

describe('completeWorkflowExecution', () => {
  it('writes the cost ledger before the run reads finished', async () => {
    const billingAttribution = await resolveBillingAttribution({
      actorUserId: ids.owner,
      workspaceId: ids.workspace,
    })
    const executionId = generateId()
    await startExecution(executionId)

    /** Holds the ledger write at its lock, so the log can be read while it waits there. */
    const lockHeld = createDeferred<void>()
    const releaseLock = createDeferred<void>()
    const holder = db.transaction(async (tx) => {
      await acquireAdvisoryXactLock(tx, USAGE_RECONCILE_LOCK, executionId)
      lockHeld.resolve()
      await releaseLock.promise
    })
    await lockHeld.promise

    const completion = executionLogger.completeWorkflowExecution({
      executionId,
      endedAt: new Date().toISOString(),
      totalDurationMs: 5,
      costSummary: calculateCostSummary([], { baseExecutionCharge: EXECUTION_FEE }),
      finalOutput: {},
      traceSpans: [],
      status: 'completed',
      actorUserId: ids.owner,
      billingAttribution,
    })

    /** A completion that settles before blocking surfaces its own outcome instead of a timeout. */
    const settledWithoutBlocking = completion.then(() => {
      throw new Error('Completion finished without waiting on the ledger lock')
    })

    let statusWhileLedgerBlocked: string | undefined
    try {
      await Promise.race([
        vi.waitFor(async () => {
          expect(await isLedgerLockAwaited(executionId)).toBe(true)
        }),
        settledWithoutBlocking,
      ])
      statusWhileLedgerBlocked = (await logRow(executionId))?.status
    } finally {
      releaseLock.resolve()
      await holder
    }
    await completion

    expect(statusWhileLedgerBlocked).toBe('running')
    expect(await logRow(executionId)).toMatchObject({ status: 'completed' })
    expect((await buildCostLedger(executionId))?.total).toBeCloseTo(EXECUTION_FEE, 8)
    expect(Number((await logRow(executionId))?.costTotal)).toBeCloseTo(EXECUTION_FEE, 8)
  })
})
