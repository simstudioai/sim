/** Real PostgreSQL coverage for the atomic import primitive shared by the admin imports. */
import { db } from '@sim/db'
import { user, workflow, workspace } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import type { WorkflowState } from '@sim/workflow-types/workflow'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createWorkflowWithState } from '@/lib/workflows/orchestration/workflow-lifecycle'

const userId = generateId()
const workspaceId = generateId()
const archivedWorkspaceId = generateId()
const governance = { workspaceId: null, subjectUserId: null }
const emptyState = { blocks: {}, edges: [], loops: {}, parallels: {} } as unknown as WorkflowState

function create(name: string, state: WorkflowState, targetWorkspaceId = workspaceId) {
  return createWorkflowWithState({
    id: generateId(),
    userId,
    workspaceId: targetWorkspaceId,
    folderId: null,
    name,
    state,
    governance,
  })
}

describe('createWorkflowWithState against PostgreSQL', () => {
  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Import fixture',
      email: `${userId}@workflow.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(workspace).values([
      { id: workspaceId, name: 'Import target', ownerId: userId, billedAccountUserId: userId },
      {
        id: archivedWorkspaceId,
        name: 'Archived target',
        ownerId: userId,
        billedAccountUserId: userId,
        archivedAt: now,
      },
    ])
  })

  afterAll(async () => {
    await db.delete(workspace).where(eq(workspace.ownerId, userId))
    await db.delete(user).where(eq(user.id, userId))
  })

  it('rolls the workflow row back when its state fails to persist', async () => {
    const id = generateId()
    const danglingEdge = {
      ...emptyState,
      edges: [{ id: generateId(), source: generateId(), target: generateId() }],
    } as unknown as WorkflowState
    const result = await createWorkflowWithState({
      id,
      userId,
      workspaceId,
      folderId: null,
      name: 'Broken import',
      state: danglingEdge,
      governance,
    })
    expect(result.success).toBe(false)
    expect(await db.select().from(workflow).where(eq(workflow.id, id))).toEqual([])
  })

  it('deduplicates a taken name inside the transaction instead of failing', async () => {
    const first = await create('Same name', emptyState)
    const second = await create('Same name', emptyState)
    if (!first.success || !second.success) throw new Error('Expected both imports to succeed')
    expect(second.workflow.name).not.toBe(first.workflow.name)
  })

  it('refuses an archived workspace without writing a row', async () => {
    await expect(create('Late import', emptyState, archivedWorkspaceId)).rejects.toMatchObject({
      code: 'not_found',
    })
    expect(
      await db.select().from(workflow).where(eq(workflow.workspaceId, archivedWorkspaceId))
    ).toEqual([])
  })
})
