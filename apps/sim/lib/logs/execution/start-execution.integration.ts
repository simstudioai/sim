/**
 * Execution-log start against real PostgreSQL: snapshot deduplication, the per-execution
 * idempotent start, and recovery when orphan cleanup removes a snapshot a run resolved.
 */
import { db } from '@sim/db'
import {
  user,
  workflow,
  workflowExecutionLogs,
  workflowExecutionSnapshots,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { executionLogger } from '@/lib/logs/execution/logger'
import type { WorkflowState } from '@/lib/logs/types'

const ids = {
  owner: `start-log-owner-${generateId()}`,
  workspace: generateId(),
  workflow: generateId(),
}

function stateWith(label: string): WorkflowState {
  return {
    blocks: {
      start: {
        id: 'start',
        type: 'starter',
        name: label,
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
}

async function startExecution(executionId: string, state: WorkflowState, deadline?: Date) {
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
    workflowState: state,
    executionDeadlineAt: deadline,
  })
}

async function logRow(executionId: string) {
  const [row] = await db
    .select()
    .from(workflowExecutionLogs)
    .where(eq(workflowExecutionLogs.executionId, executionId))
  return row
}

async function snapshotRows() {
  return db
    .select({ id: workflowExecutionSnapshots.id, stateHash: workflowExecutionSnapshots.stateHash })
    .from(workflowExecutionSnapshots)
    .where(eq(workflowExecutionSnapshots.workflowId, ids.workflow))
}

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values({
    id: ids.owner,
    name: 'Start Log',
    email: `${ids.owner}@start-log.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(workspace).values({
    id: ids.workspace,
    name: 'Start Log',
    ownerId: ids.owner,
    billedAccountUserId: ids.owner,
  })
  await db.insert(workflow).values({
    id: ids.workflow,
    userId: ids.owner,
    workspaceId: ids.workspace,
    name: 'Start Log',
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
})

afterAll(async () => {
  // Snapshots outlive their workflow (workflow_id is set null), so remove them first.
  await db.delete(workflowExecutionLogs).where(eq(workflowExecutionLogs.workflowId, ids.workflow))
  await db
    .delete(workflowExecutionSnapshots)
    .where(eq(workflowExecutionSnapshots.workflowId, ids.workflow))
  await db.delete(workspace).where(eq(workspace.id, ids.workspace))
  await db.delete(user).where(eq(user.id, ids.owner))
})

describe('startWorkflowExecution', () => {
  it('stores one snapshot per distinct state and points every run at it', async () => {
    const state = stateWith('dedup')
    const [first, second] = [generateId(), generateId()]
    await startExecution(first, state)
    await startExecution(second, state)

    const [firstLog, secondLog] = [await logRow(first), await logRow(second)]
    expect(firstLog.status).toBe('running')
    expect(secondLog.stateSnapshotId).toBe(firstLog.stateSnapshotId)

    const changed = generateId()
    await startExecution(changed, stateWith('dedup changed'))
    expect((await logRow(changed)).stateSnapshotId).not.toBe(firstLog.stateSnapshotId)

    const hashes = (await snapshotRows()).map((row) => row.stateHash)
    expect(new Set(hashes).size).toBe(hashes.length)
  })

  it('keeps one row for a repeated start and refreshes the deadline only while it runs', async () => {
    const executionId = generateId()
    const state = stateWith('idempotent')
    await startExecution(executionId, state, new Date('2030-01-01T00:00:00Z'))
    await startExecution(executionId, state, new Date('2030-01-02T00:00:00Z'))

    const rows = await db
      .select()
      .from(workflowExecutionLogs)
      .where(eq(workflowExecutionLogs.executionId, executionId))
    expect(rows).toHaveLength(1)
    expect(rows[0].executionDeadlineAt?.toISOString()).toBe('2030-01-02T00:00:00.000Z')

    await db
      .update(workflowExecutionLogs)
      .set({ status: 'completed' })
      .where(eq(workflowExecutionLogs.executionId, executionId))
    await startExecution(executionId, state, new Date('2030-01-03T00:00:00Z'))
    expect((await logRow(executionId)).executionDeadlineAt?.toISOString()).toBe(
      '2030-01-02T00:00:00.000Z'
    )
  })

  it('recovers when orphan cleanup deleted the snapshot a previous run resolved', async () => {
    const state = stateWith('cleaned up')
    const first = generateId()
    await startExecution(first, state)
    const { stateSnapshotId } = await logRow(first)

    await db.delete(workflowExecutionLogs).where(eq(workflowExecutionLogs.executionId, first))
    await db
      .delete(workflowExecutionSnapshots)
      .where(eq(workflowExecutionSnapshots.id, stateSnapshotId))

    const second = generateId()
    await startExecution(second, state)
    const secondLog = await logRow(second)
    const [snapshot] = await db
      .select({ id: workflowExecutionSnapshots.id })
      .from(workflowExecutionSnapshots)
      .where(eq(workflowExecutionSnapshots.id, secondLog.stateSnapshotId))
    expect(secondLog.status).toBe('running')
    expect(snapshot).toBeDefined()
  })

  it('stores a single snapshot when concurrent runs start a new state together', async () => {
    const state = stateWith('concurrent')
    const executionIds = Array.from({ length: 6 }, () => generateId())
    await Promise.all(executionIds.map((executionId) => startExecution(executionId, state)))

    const logs = await db
      .select({ stateSnapshotId: workflowExecutionLogs.stateSnapshotId })
      .from(workflowExecutionLogs)
      .where(inArray(workflowExecutionLogs.executionId, executionIds))
    expect(logs).toHaveLength(executionIds.length)
    expect(new Set(logs.map((log) => log.stateSnapshotId)).size).toBe(1)
  })
})
