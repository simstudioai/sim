import { db } from '@sim/db'
import { user, workflowExecutionLogs, workflowExecutionSnapshots, workspace } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPublicWorkflowLog } from '@/lib/logs/public-queries'

const userId = generateId()
const workspaceId = generateId()
const snapshotId = generateId()
const runId = generateId()
const snapshot = { blocks: {}, edges: [], variables: { fixture: 'persisted configuration' } }

/** Uses the real projection and joins; a SQL mock cannot prove snapshot omission or isolation. */
describe('public log snapshot projection against PostgreSQL', () => {
  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Log fixture',
      email: `${userId}@logs.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(workspace).values({
      id: workspaceId,
      name: 'Log fixture',
      ownerId: userId,
      billedAccountUserId: userId,
    })
    await db.insert(workflowExecutionSnapshots).values({
      id: snapshotId,
      stateHash: generateId(),
      stateData: snapshot,
    })
    await db.insert(workflowExecutionLogs).values({
      id: generateId(),
      workspaceId,
      executionId: runId,
      stateSnapshotId: snapshotId,
      level: 'info',
      status: 'completed',
      trigger: 'manual',
      startedAt: now,
      executionData: { finalOutput: { delivered: false } },
    })
  })

  afterAll(async () => {
    await db.delete(workspace).where(eq(workspace.id, workspaceId))
    await db.delete(workflowExecutionSnapshots).where(eq(workflowExecutionSnapshots.id, snapshotId))
    await db.delete(user).where(eq(user.id, userId))
    await db.$client.end()
  })

  it('keeps the legacy default and omits only the snapshot when explicitly requested', async () => {
    const lookup = { column: 'executionId', value: runId } as const
    const before = await getPublicWorkflowLog(lookup, workspaceId)
    const explicit = await getPublicWorkflowLog(lookup, workspaceId, { includeWorkflowState: true })
    const compact = await getPublicWorkflowLog(lookup, workspaceId, { includeWorkflowState: false })

    expect(before?.workflowState).toEqual(snapshot)
    expect(explicit).toEqual(before)
    expect(compact).toEqual({ ...before, workflowState: null })
    expect(await getPublicWorkflowLog(lookup, workspaceId)).toEqual(before)
  })

  it.each([true, false])(
    'keeps workspace isolation with includeWorkflowState=%s',
    async (includeWorkflowState) => {
      expect(
        await getPublicWorkflowLog({ column: 'executionId', value: runId }, generateId(), {
          includeWorkflowState,
        })
      ).toBeNull()
    }
  )
})
