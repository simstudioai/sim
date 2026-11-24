/**
 * Real PostgreSQL coverage: canvas deletes through the realtime server prune the deleted blocks'
 * and variables' entries from the `workflow_source_meta` side table, and delete its row once nothing
 * is left, so source idents and comments never outlive what they describe.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { db } from '@sim/db'
import { user, workflow, workflowBlocks, workflowSourceMeta, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import {
  BLOCKS_OPERATIONS,
  OPERATION_TARGETS,
  VARIABLE_OPERATIONS,
} from '@sim/realtime-protocol/constants'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { persistWorkflowOperation } from '@/database/operations'

const userId = generateId()
const workspaceId = generateId()
const workflowId = generateId()
const keptId = generateId()
const deletedId = generateId()
const variableId = generateId()
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

function persist(target: string, operation: string, payload: unknown) {
  return persistWorkflowOperation(workflowId, {
    target,
    operation,
    payload,
    timestamp: Date.now(),
    userId,
  })
}

/** Seeds the stored JSON value directly, as the apply path would have left it. */
async function seedStoredMeta(meta: Record<string, unknown>) {
  const updatedAt = new Date()
  await db
    .insert(workflowSourceMeta)
    .values({ workflowId, meta, updatedAt })
    .onConflictDoUpdate({ target: workflowSourceMeta.workflowId, set: { meta, updatedAt } })
}

async function storedMeta(): Promise<unknown> {
  const [row] = await db
    .select({ meta: workflowSourceMeta.meta })
    .from(workflowSourceMeta)
    .where(eq(workflowSourceMeta.workflowId, workflowId))
  return row?.meta
}

describe('workflow_source_meta pruning on realtime canvas deletes', () => {
  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Code meta prune fixture',
      email: `${userId}@source-meta-prune.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await insertWorkspaceFixture(db, {
      id: workspaceId,
      name: 'Code meta prune',
      ownerId: userId,
      billedAccountUserId: userId,
    })
    await db.insert(workflow).values({
      id: workflowId,
      userId,
      workspaceId,
      name: 'Code meta prune',
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
      variables: {
        [variableId]: { id: variableId, workflowId, name: 'retries', type: 'number', value: 3 },
      },
    })
    await db.insert(workflowBlocks).values(
      [keptId, deletedId].map((id, index) => ({
        id,
        workflowId,
        type: 'function',
        name: `Block ${index}`,
        positionX: '0',
        positionY: String(index * 100),
      }))
    )
  })

  afterAll(async () => {
    const reportPath =
      process.env.REALTIME_SOURCE_META_PRUNE_REPORT_PATH ??
      resolve('test-results/realtime-source-meta-prune.json')
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
    await deleteWorkspaceFixture(db, eq(workspace.ownerId, userId))
    await db.delete(user).where(eq(user.id, userId))
  })

  check('a block delete drops its entries and keeps the rest', async () => {
    await seedStoredMeta({
      version: 1,
      idents: { [keptId]: 'kept', [deletedId]: 'doomed' },
      order: { [keptId]: 0, [deletedId]: 1 },
      comments: {},
    })

    await persist(OPERATION_TARGETS.BLOCKS, BLOCKS_OPERATIONS.BATCH_REMOVE_BLOCKS, {
      ids: [deletedId],
    })

    expect(await storedMeta()).toEqual({
      version: 1,
      idents: { [keptId]: 'kept' },
      order: { [keptId]: 0 },
      comments: {},
    })
  })

  check('a variable delete that leaves nothing removes the row', async () => {
    await seedStoredMeta({
      version: 1,
      idents: {},
      order: {},
      comments: {
        [`var:${variableId}`]: [{ text: ' retry budget', kind: 'line', placement: 'trailing' }],
      },
    })
    expect(await storedMeta()).toBeDefined()

    await persist(OPERATION_TARGETS.VARIABLE, VARIABLE_OPERATIONS.REMOVE, { variableId })

    expect(await storedMeta()).toBeUndefined()
  })
})
