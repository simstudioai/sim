/**
 * Completion ordering against real PostgreSQL: a run's usage ledger is durable before
 * its log reads terminal, so a reader that sees a finished run always sees its cost.
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
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveBillingAttribution } from '@/lib/billing/core/billing-attribution'
import { buildCostLedger } from '@/lib/logs/cost-ledger'
import { executionLogger } from '@/lib/logs/execution/logger'
import { calculateCostSummary } from '@/lib/logs/execution/logging-factory'
import type { WorkflowState } from '@/lib/logs/types'

const ids = {
  owner: `ledger-order-owner-${generateId()}`,
  workspace: generateId(),
  workflow: generateId(),
}

/** Enough completions that an ordering gap is observed on every run where one exists. */
const COMPLETIONS = 20
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

describe('completeWorkflowExecution', () => {
  it('never exposes a finished run before its cost ledger', async () => {
    const billingAttribution = await resolveBillingAttribution({
      actorUserId: ids.owner,
      workspaceId: ids.workspace,
    })
    let finishedWithoutLedger = 0

    for (let i = 0; i < COMPLETIONS; i++) {
      const executionId = generateId()
      await startExecution(executionId)

      /**
       * The ledger only grows, so the first read that finds the run finished is the one that
       * counts. Settlement is captured before each read, so a read already in flight when the
       * completion lands cannot end the loop before the finished run is observed.
       */
      let completing = true
      const reader = (async () => {
        for (;;) {
          const settledBeforeRead = !completing
          if ((await logRow(executionId))?.status === 'completed') {
            if ((await buildCostLedger(executionId)) === null) finishedWithoutLedger++
            return
          }
          if (settledBeforeRead) return
        }
      })()

      try {
        await executionLogger.completeWorkflowExecution({
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
      } finally {
        completing = false
        // Settle the reader without letting its error replace a completion failure.
        await reader.catch(() => {})
      }
      await reader

      const ledger = await buildCostLedger(executionId)
      expect(ledger?.total).toBeCloseTo(EXECUTION_FEE, 8)
      expect(Number((await logRow(executionId))?.costTotal)).toBeCloseTo(EXECUTION_FEE, 8)
    }

    expect(finishedWithoutLedger).toBe(0)
  })
})
