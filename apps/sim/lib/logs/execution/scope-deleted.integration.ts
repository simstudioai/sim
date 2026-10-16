/**
 * A run whose workspace or workflow is hard-deleted while it runs, against real PostgreSQL: the
 * session recognizes the deletion from the real foreign-key and missing-row outcomes, ends the
 * run quietly, and still reports a log row lost under a live workspace as the failure it is.
 */
import { db } from '@sim/db'
import {
  user,
  workflow,
  workflowExecutionLogs,
  workflowExecutionSnapshots,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { executionLogger } from '@/lib/logs/execution/logger'
import { calculateCostSummary } from '@/lib/logs/execution/logging-factory'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import type { WorkflowState } from '@/lib/logs/types'

const ownerId = `scope-deleted-owner-${generateId()}`
const workspaceIds: string[] = []
const snapshotIds: string[] = []

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

/** A workspace holding one workflow, removed in `afterAll` unless a test deletes it first. */
async function createScope() {
  const scope = { workspaceId: generateId(), workflowId: generateId() }
  workspaceIds.push(scope.workspaceId)
  const now = new Date()
  await insertWorkspaceFixture(db, {
    id: scope.workspaceId,
    name: 'Scope Deleted',
    ownerId,
    billedAccountUserId: ownerId,
  })
  await db.insert(workflow).values({
    id: scope.workflowId,
    userId: ownerId,
    workspaceId: scope.workspaceId,
    name: 'Scope Deleted',
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
  return scope
}

function startSession(scope: { workspaceId: string; workflowId: string }, executionId: string) {
  const session = new LoggingSession(scope.workflowId, executionId, 'api', 'scope-deleted')
  return {
    session,
    started: session.safeStart({ userId: ownerId, workspaceId: scope.workspaceId, workflowState }),
  }
}

async function logRow(executionId: string) {
  const [row] = await db
    .select({
      status: workflowExecutionLogs.status,
      stateSnapshotId: workflowExecutionLogs.stateSnapshotId,
    })
    .from(workflowExecutionLogs)
    .where(eq(workflowExecutionLogs.executionId, executionId))
  return row
}

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values({
    id: ownerId,
    name: 'Scope Deleted',
    email: `${ownerId}@scope-deleted.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
})

afterAll(async () => {
  await deleteWorkspaceFixture(db, inArray(workspace.id, workspaceIds))
  /** Snapshots outlive their workflow (its workflow_id is set null), so remove them by id. */
  if (snapshotIds.length > 0) {
    await db
      .delete(workflowExecutionSnapshots)
      .where(inArray(workflowExecutionSnapshots.id, snapshotIds))
  }
  await db.delete(user).where(eq(user.id, ownerId))
})

describe('a run whose scope is deleted mid-run', () => {
  it('ends quietly when its workspace is deleted before completion', async () => {
    const scope = await createScope()
    const executionId = generateId()
    const { session, started } = startSession(scope, executionId)
    expect(await started).toBe(true)
    const startedLog = await logRow(executionId)
    snapshotIds.push(startedLog.stateSnapshotId)

    await deleteWorkspaceFixture(db, eq(workspace.id, scope.workspaceId))
    expect(await logRow(executionId)).toBeUndefined()

    await expect(session.safeComplete({ finalOutput: { ok: true } })).resolves.toBeUndefined()

    expect(session.getDeletedScope()).toBe('workspace')
    expect(session.hasCompleted()).toBe(false)
    expect(await logRow(executionId)).toBeUndefined()
  })

  it('still fails loudly when a log row is lost while its workspace exists', async () => {
    const scope = await createScope()

    await expect(
      executionLogger.completeWorkflowExecution({
        executionId: generateId(),
        workspaceId: scope.workspaceId,
        endedAt: new Date().toISOString(),
        totalDurationMs: 5,
        costSummary: calculateCostSummary([]),
        finalOutput: {},
        traceSpans: [],
        status: 'completed',
      })
    ).rejects.toThrow(/^Workflow log not found for execution /)
  })

  it('does not start a run whose workspace is already deleted', async () => {
    const scope = await createScope()
    await deleteWorkspaceFixture(db, eq(workspace.id, scope.workspaceId))
    const executionId = generateId()

    const { session, started } = startSession(scope, executionId)

    expect(await started).toBe(false)
    expect(session.getDeletedScope()).toBe('workspace')
    expect(await logRow(executionId)).toBeUndefined()
  })

  it('does not start a run whose workflow is deleted from a live workspace', async () => {
    const scope = await createScope()
    await db.delete(workflow).where(eq(workflow.id, scope.workflowId))
    const executionId = generateId()

    const { session, started } = startSession(scope, executionId)

    expect(await started).toBe(false)
    expect(session.getDeletedScope()).toBe('workflow')
    expect(await logRow(executionId)).toBeUndefined()
  })

  it('reports no deleted scope while both still exist', async () => {
    const scope = await createScope()

    await expect(executionLogger.findDeletedExecutionScope(scope)).resolves.toBeNull()
  })
})
