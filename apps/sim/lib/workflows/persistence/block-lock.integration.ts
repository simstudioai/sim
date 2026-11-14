/** Real PostgreSQL coverage: a write-role full-state replace never changes what a block lock protects. */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { db } from '@sim/db'
import { user, workflowBlocks, workflowEdges, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createWorkflowWithState } from '@/lib/workflows/orchestration/workflow-lifecycle'
import { replaceWorkflowNormalizedState } from '@/lib/workflows/persistence/replace-normalized-state'

const userId = generateId()
const workspaceId = generateId()
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

function block(id: string, name: string, extra: Partial<BlockState> = {}): BlockState {
  return {
    id,
    type: 'function',
    name,
    position: { x: 0, y: 0 },
    subBlocks: {},
    outputs: {},
    enabled: true,
    ...extra,
  }
}

describe('replaceWorkflowNormalizedState block locks against PostgreSQL', () => {
  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Lock fixture',
      email: `${userId}@block-lock.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await insertWorkspaceFixture(db, {
      id: workspaceId,
      name: 'Lock target',
      ownerId: userId,
      billedAccountUserId: userId,
    })
  })

  afterAll(async () => {
    const reportPath =
      process.env.WORKFLOW_BLOCK_LOCK_REPORT_PATH ??
      resolve('test-results/workflow-block-lock.json')
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
    await deleteWorkspaceFixture(db, eq(workspace.ownerId, userId))
    await db.delete(user).where(eq(user.id, userId))
  })

  check(
    'keeps locked blocks and their incoming edges as stored, and writes the rest unlocked',
    async () => {
      const workflowId = generateId()
      const lockedId = generateId()
      const freeId = generateId()
      const addedId = generateId()
      const edgeId = generateId()
      const seeded: WorkflowState = {
        blocks: {
          [lockedId]: block(lockedId, 'Locked', { locked: true }),
          [freeId]: block(freeId, 'Free'),
        },
        edges: [{ id: edgeId, source: freeId, target: lockedId }],
        loops: {},
        parallels: {},
      }
      const created = await createWorkflowWithState({
        id: workflowId,
        userId,
        workspaceId,
        folderId: null,
        name: 'Locked blocks',
        state: seeded,
        governance: { workspaceId: null, subjectUserId: null },
      })
      expect(created).toMatchObject({ success: true })

      const { state } = await replaceWorkflowNormalizedState({
        workflowId,
        workspaceId: null,
        attributedUserId: userId,
        subjectUserId: null,
        state: {
          blocks: {
            // A record key that differs from the block's id must not slip past the lock.
            decoy: block(lockedId, 'Hijacked', { locked: false }),
            [freeId]: block(freeId, 'Free renamed', { locked: true }),
            [addedId]: block(addedId, 'Added', { locked: true }),
          },
          edges: [],
        },
      })

      const rows = await db
        .select()
        .from(workflowBlocks)
        .where(eq(workflowBlocks.workflowId, workflowId))
      const byId = Object.fromEntries(rows.map((row) => [row.id, row]))
      expect(byId[lockedId]).toMatchObject({ locked: true, name: 'Locked' })
      expect(byId[freeId]).toMatchObject({ locked: false, name: 'Free renamed' })
      expect(byId[addedId]).toMatchObject({ locked: false })
      expect(state.blocks[lockedId]).toMatchObject({ locked: true, name: 'Locked' })

      const edges = await db
        .select({ id: workflowEdges.id })
        .from(workflowEdges)
        .where(eq(workflowEdges.workflowId, workflowId))
      expect(edges).toEqual([{ id: edgeId }])
    }
  )
})
