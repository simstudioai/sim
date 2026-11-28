/** Real PostgreSQL coverage: a realtime batch add never grows a workflow past the shared block cap, nor leaves subflow rows without their block. */
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
import { BLOCKS_OPERATIONS, OPERATION_TARGETS } from '@sim/realtime-protocol/constants'
import { WorkflowOperationSchema } from '@sim/realtime-protocol/schemas'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { MAX_WORKFLOW_BLOCKS, MAX_WORKFLOW_EDGES } from '@sim/workflow-types/workflow'
import { count, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { persistWorkflowOperation } from '@/database/operations'

const userId = generateId()
const workspaceId = generateId()
const workflowId = generateId()
const existingIds = Array.from({ length: MAX_WORKFLOW_BLOCKS - 1 }, () => generateId())
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

function payloadBlock(id: string) {
  return { id, type: 'function', name: id, position: { x: 0, y: 0 }, subBlocks: {} }
}

function batchAdd(payload: Record<string, unknown>) {
  return {
    operation: BLOCKS_OPERATIONS.BATCH_ADD_BLOCKS,
    target: OPERATION_TARGETS.BLOCKS,
    payload,
    timestamp: Date.now(),
  }
}

function persist(payload: Record<string, unknown>) {
  return persistWorkflowOperation(workflowId, { ...batchAdd(payload), userId })
}

async function countRows(
  table: typeof workflowBlocks | typeof workflowEdges | typeof workflowSubflows
) {
  const [row] = await db.select({ n: count() }).from(table).where(eq(table.workflowId, workflowId))
  return row.n
}

describe('realtime batch-add block cap against PostgreSQL', () => {
  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Cap fixture',
      email: `${userId}@batch-add-cap.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await insertWorkspaceFixture(db, {
      id: workspaceId,
      name: 'Cap target',
      ownerId: userId,
      billedAccountUserId: userId,
    })
    await db.insert(workflow).values({
      id: workflowId,
      userId,
      workspaceId,
      name: 'Nearly full',
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
    })
  })

  beforeEach(async () => {
    await db.delete(workflowSubflows).where(eq(workflowSubflows.workflowId, workflowId))
    await db.delete(workflowEdges).where(eq(workflowEdges.workflowId, workflowId))
    await db.delete(workflowBlocks).where(eq(workflowBlocks.workflowId, workflowId))
    await db.insert(workflowBlocks).values(
      existingIds.map((id) => ({
        id,
        workflowId,
        type: 'function',
        name: id,
        positionX: '0',
        positionY: '0',
      }))
    )
  })

  afterAll(async () => {
    const reportPath =
      process.env.REALTIME_BATCH_ADD_CAP_REPORT_PATH ??
      resolve('test-results/realtime-batch-add-cap.json')
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
    await deleteWorkspaceFixture(db, eq(workspace.ownerId, userId))
    await db.delete(user).where(eq(user.id, userId))
  })

  check('a single message over the cap fails protocol validation', async () => {
    const blocks = Array.from({ length: MAX_WORKFLOW_BLOCKS + 1 }, () => payloadBlock(generateId()))
    const edges = Array.from({ length: MAX_WORKFLOW_EDGES + 1 }, () => ({
      id: generateId(),
      source: 'a',
      target: 'b',
    }))
    const loops = Object.fromEntries(blocks.map((block) => [block.id, {}]))

    expect(WorkflowOperationSchema.safeParse(batchAdd({ blocks })).success).toBe(false)
    expect(WorkflowOperationSchema.safeParse(batchAdd({ blocks: [], edges })).success).toBe(false)
    expect(WorkflowOperationSchema.safeParse(batchAdd({ blocks: [], loops })).success).toBe(false)
    expect(
      WorkflowOperationSchema.safeParse(batchAdd({ blocks: blocks.slice(1), edges: [] })).success
    ).toBe(true)
  })

  check('a batch that would push the workflow past the cap writes nothing', async () => {
    const [first, second] = [generateId(), generateId()]
    const result = await persist({
      blocks: [payloadBlock(first), payloadBlock(second)],
      edges: [{ id: generateId(), source: first, target: second }],
    })

    expect(result).toEqual({ reconcile: true })
    expect(await countRows(workflowBlocks)).toBe(MAX_WORKFLOW_BLOCKS - 1)
    expect(await countRows(workflowEdges)).toBe(0)
  })

  check('re-sent existing blocks do not count toward the cap', async () => {
    const added = generateId()
    const result = await persist({
      blocks: [...existingIds.slice(0, 10).map(payloadBlock), payloadBlock(added)],
    })

    expect(result).toEqual({ reconcile: false })
    expect(await countRows(workflowBlocks)).toBe(MAX_WORKFLOW_BLOCKS)
  })

  check('loop and parallel configs land only for a stored or added block', async () => {
    const loopId = generateId()
    const orphan = await persist({
      blocks: [],
      loops: { [generateId()]: { nodes: [] } },
      parallels: { [generateId()]: { nodes: [] } },
    })
    expect(orphan).toEqual({ reconcile: true })
    expect(await countRows(workflowSubflows)).toBe(0)

    const added = await persist({
      blocks: [{ ...payloadBlock(loopId), type: 'loop' }],
      loops: { [loopId]: { nodes: [], iterations: 4, loopType: 'for' } },
    })
    expect(added).toEqual({ reconcile: false })
    expect(await countRows(workflowSubflows)).toBe(1)

    const existing = await persist({ blocks: [], loops: { [existingIds[0]]: { nodes: [] } } })
    expect(existing).toEqual({ reconcile: false })
    expect(await countRows(workflowSubflows)).toBe(2)
  })
})
