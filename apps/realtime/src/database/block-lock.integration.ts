/** Real PostgreSQL coverage: realtime batch-add and replace-state never change what a block lock protects. */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { db } from '@sim/db'
import {
  user,
  workflow,
  workflowBlocks,
  workflowEdges,
  workflowSubflows,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import {
  BLOCKS_OPERATIONS,
  OPERATION_TARGETS,
  WORKFLOW_OPERATIONS,
} from '@sim/realtime-protocol/constants'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { persistWorkflowOperation } from '@/database/operations'

const userId = generateId()
const workspaceId = generateId()
const workflowId = generateId()
const ids = {
  locked: generateId(),
  container: generateId(),
  child: generateId(),
  free: generateId(),
  edgeIntoLocked: generateId(),
}
const lockedLoopConfig = { id: ids.container, nodes: [ids.child], iterations: 3, loopType: 'for' }
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

function blockRow(
  id: string,
  name: string,
  extra: Partial<typeof workflowBlocks.$inferInsert> = {}
) {
  return {
    id,
    workflowId,
    type: 'function',
    name,
    positionX: '0',
    positionY: '0',
    ...extra,
  }
}

function payloadBlock(id: string, name: string, extra: Record<string, unknown> = {}) {
  return { id, type: 'function', name, position: { x: 10, y: 10 }, subBlocks: {}, ...extra }
}

function persist(target: string, operation: string, payload: unknown) {
  return persistWorkflowOperation(workflowId, {
    target,
    operation,
    payload,
    timestamp: Date.now(),
    userId,
  })
}

async function readBlocks() {
  const rows = await db
    .select()
    .from(workflowBlocks)
    .where(eq(workflowBlocks.workflowId, workflowId))
  return Object.fromEntries(rows.map((row) => [row.id, row]))
}

describe('block locks against PostgreSQL', () => {
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
    await db.insert(workflow).values({
      id: workflowId,
      userId,
      workspaceId,
      name: 'Locked blocks',
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
    })
  })

  beforeEach(async () => {
    await db.delete(workflowSubflows).where(eq(workflowSubflows.workflowId, workflowId))
    await db.delete(workflowBlocks).where(eq(workflowBlocks.workflowId, workflowId))
    await db
      .insert(workflowBlocks)
      .values([
        blockRow(ids.locked, 'Locked', { locked: true }),
        blockRow(ids.container, 'Locked loop', { type: 'loop', locked: true }),
        blockRow(ids.child, 'Child', { data: { parentId: ids.container, extent: 'parent' } }),
        blockRow(ids.free, 'Free'),
      ])
    await db.insert(workflowEdges).values({
      id: ids.edgeIntoLocked,
      workflowId,
      sourceBlockId: ids.free,
      targetBlockId: ids.locked,
    })
    await db.insert(workflowSubflows).values({
      id: ids.container,
      workflowId,
      type: 'loop',
      config: lockedLoopConfig,
    })
  })

  afterAll(async () => {
    const reportPath =
      process.env.REALTIME_BLOCK_LOCK_REPORT_PATH ??
      resolve('test-results/realtime-block-lock.json')
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
    await deleteWorkspaceFixture(db, eq(workspace.ownerId, userId))
    await db.delete(user).where(eq(user.id, userId))
  })

  check('batch-add-blocks cannot unlock or overwrite a locked block', async () => {
    await persist(OPERATION_TARGETS.BLOCKS, BLOCKS_OPERATIONS.BATCH_ADD_BLOCKS, {
      blocks: [
        payloadBlock(ids.locked, 'Hijacked', { locked: false }),
        payloadBlock(ids.child, 'Hijacked child'),
      ],
      edges: [],
      loops: {},
      parallels: {},
    })

    const blocks = await readBlocks()
    expect(blocks[ids.locked]).toMatchObject({ locked: true, name: 'Locked' })
    expect(blocks[ids.child]).toMatchObject({ name: 'Child' })
  })

  check(
    'batch-add-blocks never takes the lock flag from the client nor nests under a locked ancestor',
    async () => {
      const lockedNew = generateId()
      const nestedNew = generateId()
      await persist(OPERATION_TARGETS.BLOCKS, BLOCKS_OPERATIONS.BATCH_ADD_BLOCKS, {
        blocks: [
          payloadBlock(lockedNew, 'Self-locked', { locked: true }),
          payloadBlock(nestedNew, 'Nested', { data: { parentId: ids.child } }),
        ],
        edges: [],
        loops: {},
        parallels: {},
      })

      const blocks = await readBlocks()
      expect(blocks[lockedNew]).toMatchObject({ locked: false })
      expect(blocks[nestedNew]).toBeUndefined()
    }
  )

  check(
    'replace-state keeps protected blocks, their incoming edges and loop config as stored, and drops blocks nested into a lock',
    async () => {
      const added = generateId()
      const nestedNew = generateId()
      await persist(OPERATION_TARGETS.WORKFLOW, WORKFLOW_OPERATIONS.REPLACE_STATE, {
        state: {
          blocks: {
            [ids.locked]: payloadBlock(ids.locked, 'Hijacked', { locked: false }),
            [ids.free]: payloadBlock(ids.free, 'Free renamed', { locked: true }),
            [added]: payloadBlock(added, 'Added'),
            [nestedNew]: payloadBlock(nestedNew, 'Nested', {
              data: { parentId: ids.container, extent: 'parent' },
            }),
          },
          edges: [{ id: generateId(), source: ids.free, target: nestedNew }],
          loops: { [ids.container]: { ...lockedLoopConfig, iterations: 99 } },
          parallels: {},
        },
      })

      const blocks = await readBlocks()
      expect(blocks[ids.locked]).toMatchObject({ locked: true, name: 'Locked' })
      expect(blocks[ids.container]).toMatchObject({ locked: true, name: 'Locked loop' })
      expect(blocks[ids.child]).toMatchObject({ name: 'Child' })
      expect(blocks[ids.free]).toMatchObject({ locked: false, name: 'Free renamed' })
      expect(blocks[added]).toMatchObject({ locked: false })
      expect(blocks[nestedNew]).toBeUndefined()

      const edges = await db
        .select()
        .from(workflowEdges)
        .where(eq(workflowEdges.workflowId, workflowId))
      expect(edges.map((edge) => edge.id)).toEqual([ids.edgeIntoLocked])

      const subflows = await db
        .select({ id: workflowSubflows.id, config: workflowSubflows.config })
        .from(workflowSubflows)
        .where(eq(workflowSubflows.workflowId, workflowId))
      expect(subflows).toEqual([{ id: ids.container, config: lockedLoopConfig }])
    }
  )
})
