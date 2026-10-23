/** Real PostgreSQL coverage for the workflow create primitives: the atomic import and a plain create. */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { db } from '@sim/db'
import { user, workflow, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import type { WorkflowState } from '@sim/workflow-types/workflow'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createWorkflowWithState,
  performCreateWorkflow,
} from '@/lib/workflows/orchestration/workflow-lifecycle'

const userId = generateId()
const workspaceId = generateId()
const archivedWorkspaceId = generateId()
const governance = { workspaceId: null, subjectUserId: null }
const emptyState: WorkflowState = { blocks: {}, edges: [], loops: {}, parallels: {} }
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []

/** Registers a test and records its status and duration in the suite report. */
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
    await insertWorkspaceFixture(db, [
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
    const reportPath =
      process.env.CREATE_WORKFLOW_WITH_STATE_REPORT_PATH ??
      resolve('test-results/create-workflow-with-state.json')
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
    await deleteWorkspaceFixture(db, eq(workspace.ownerId, userId))
    await db.delete(user).where(eq(user.id, userId))
  })

  check('rolls the workflow row back when its state fails to persist', async () => {
    const id = generateId()
    const danglingEdge: WorkflowState = {
      ...emptyState,
      edges: [{ id: generateId(), source: generateId(), target: generateId() }],
    }
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

  check('deduplicates a taken name inside the transaction instead of failing', async () => {
    const first = await create('Same name', emptyState)
    const second = await create('Same name', emptyState)
    if (!first.success || !second.success) throw new Error('Expected both imports to succeed')
    expect(second.workflow.name).not.toBe(first.workflow.name)
  })

  check('reports a caller-supplied id that already exists as a conflict', async () => {
    const id = generateId()
    const first = await performCreateWorkflow({ id, userId, workspaceId, name: 'Original' })
    if (!first.success) throw new Error(`Expected the first create to succeed: ${first.error}`)

    const second = await performCreateWorkflow({ id, userId, workspaceId, name: 'Replay' })

    expect(second).toEqual({
      success: false,
      error: 'A workflow with this ID already exists',
      errorCode: 'conflict',
    })
    expect(
      await db.select({ name: workflow.name }).from(workflow).where(eq(workflow.id, id))
    ).toEqual([{ name: 'Original' }])
  })

  check(
    'reports a deduplicated create with a taken id as a conflict, not a name retry',
    async () => {
      const id = generateId()
      const first = await performCreateWorkflow({ id, userId, workspaceId, name: 'Retried' })
      if (!first.success) throw new Error(`Expected the first create to succeed: ${first.error}`)

      const second = await performCreateWorkflow({
        id,
        userId,
        workspaceId,
        name: 'Retried',
        deduplicate: true,
      })

      expect(second).toMatchObject({ success: false, errorCode: 'conflict' })
    }
  )

  check('still reports an exact-name collision as a name conflict', async () => {
    const first = await performCreateWorkflow({ userId, workspaceId, name: 'Taken name' })
    if (!first.success) throw new Error(`Expected the first create to succeed: ${first.error}`)

    const second = await performCreateWorkflow({ userId, workspaceId, name: 'Taken name' })

    expect(second).toEqual({
      success: false,
      error: 'A workflow named "Taken name" already exists in this folder',
      errorCode: 'conflict',
    })
  })

  check('refuses an archived workspace without writing a row', async () => {
    await expect(create('Late import', emptyState, archivedWorkspaceId)).rejects.toMatchObject({
      code: 'not_found',
    })
    expect(
      await db.select().from(workflow).where(eq(workflow.workspaceId, archivedWorkspaceId))
    ).toEqual([])
  })
})
