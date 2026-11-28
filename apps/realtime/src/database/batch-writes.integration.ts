/** Real PostgreSQL coverage: batch position writes stay in their workflow with the last entry winning; batch subblock writes chain per block. */
import { db } from '@sim/db'
import { user, workflow, workflowBlocks, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import {
  BLOCKS_OPERATIONS,
  OPERATION_TARGETS,
  SUBBLOCK_OPERATIONS,
} from '@sim/realtime-protocol/constants'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { persistWorkflowOperation } from '@/database/operations'

const userId = generateId()
const workspaceId = generateId()
const workflowId = generateId()
const otherWorkflowId = generateId()
const ids = { moved: generateId(), still: generateId(), foreign: generateId() }

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
    .where(inArray(workflowBlocks.id, Object.values(ids)))
  return Object.fromEntries(rows.map((row) => [row.id, row]))
}

describe('batch writes against PostgreSQL', () => {
  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Batch fixture',
      email: `${userId}@batch-writes.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await insertWorkspaceFixture(db, {
      id: workspaceId,
      name: 'Batch target',
      ownerId: userId,
      billedAccountUserId: userId,
    })
    await db.insert(workflow).values(
      [workflowId, otherWorkflowId].map((id) => ({
        id,
        userId,
        workspaceId,
        name: id,
        lastSynced: now,
        createdAt: now,
        updatedAt: now,
      }))
    )
  })

  beforeEach(async () => {
    await db.delete(workflowBlocks).where(inArray(workflowBlocks.id, Object.values(ids)))
    await db.insert(workflowBlocks).values(
      [
        { id: ids.moved, workflowId },
        { id: ids.still, workflowId },
        { id: ids.foreign, workflowId: otherWorkflowId },
      ].map((row) => ({
        ...row,
        type: 'function',
        name: row.id,
        positionX: '0',
        positionY: '0',
        subBlocks: { code: { id: 'code', type: 'code', value: 'a' } },
      }))
    )
  })

  afterAll(async () => {
    await deleteWorkspaceFixture(db, eq(workspace.ownerId, userId))
    await db.delete(user).where(eq(user.id, userId))
  })

  it('moves only this workflow’s blocks, the last entry for a block winning', async () => {
    await persist(OPERATION_TARGETS.BLOCKS, BLOCKS_OPERATIONS.BATCH_UPDATE_POSITIONS, {
      updates: [
        { id: ids.moved, position: { x: 1, y: 1 } },
        { id: ids.foreign, position: { x: 9, y: 9 } },
        { id: generateId(), position: { x: 9, y: 9 } },
        { id: ids.moved, position: { x: 12.5, y: -40 } },
      ],
    })

    const blocks = await readBlocks()
    const position = (id: string) => [Number(blocks[id].positionX), Number(blocks[id].positionY)]
    expect(position(ids.moved)).toEqual([12.5, -40])
    expect(position(ids.still)).toEqual([0, 0])
    expect(position(ids.foreign)).toEqual([0, 0])
  })

  it('applies repeated entries for one block in order, each seeing the one before', async () => {
    await persist(OPERATION_TARGETS.SUBBLOCK, SUBBLOCK_OPERATIONS.BATCH_UPDATE, {
      updates: [
        { blockId: ids.moved, subblockId: 'code', value: 'b', expectedValue: 'a' },
        { blockId: ids.moved, subblockId: 'prompt', value: 'p' },
        { blockId: ids.moved, subblockId: 'code', value: 'c', expectedValue: 'b' },
        { blockId: ids.still, subblockId: 'code', value: 'd' },
      ],
    })

    const blocks = await readBlocks()
    expect(blocks[ids.moved].subBlocks).toEqual({
      code: { id: 'code', type: 'code', value: 'c' },
      prompt: { id: 'prompt', type: 'unknown', value: 'p' },
    })
    expect(blocks[ids.still].subBlocks).toEqual({ code: { id: 'code', type: 'code', value: 'd' } })
  })
})
