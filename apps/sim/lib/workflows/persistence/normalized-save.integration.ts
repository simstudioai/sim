/**
 * The normalized-table save against real Postgres. It writes only the difference between the
 * stored graph and the new one, and must leave exactly the rows a delete-all and re-insert would:
 * random edit sequences (add, remove, modify, move into a subflow, retarget and drop edges, replace a block
 * under the edges it keeps) are
 * saved both ways and the rows compared. A one-field edit rewrites one row, and an id owned by another
 * workflow is still refused with the unique violation callers map to a conflict.
 */
import { db } from '@sim/db'
import { user, workflow, workflowBlocks, workflowEdges, workflowSubflows } from '@sim/db/schema'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { saveWorkflowToNormalizedTables } from '@sim/workflow-persistence/save'
import type { DbOrTx } from '@sim/workflow-persistence/types'
import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const ownerId = generateId()

/** Deterministic PRNG (mulberry32) so a failing sequence replays from its seed. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function functionBlock(id: string, name: string, x: number, parentId?: string): BlockState {
  return {
    id,
    type: 'function',
    name,
    position: { x, y: 0 },
    enabled: true,
    outputs: {},
    subBlocks: { code: { id: 'code', type: 'code', value: `return '${name}'` } },
    data: parentId ? { parentId, extent: 'parent' } : {},
  }
}

function containerBlock(id: string, type: 'loop' | 'parallel', name: string): BlockState {
  return {
    id,
    type,
    name,
    position: { x: 0, y: 400 },
    enabled: true,
    outputs: {},
    subBlocks: {},
    data: type === 'loop' ? { loopType: 'for', count: 3 } : { parallelType: 'count', count: 2 },
  }
}

function stateOf(blocks: BlockState[], edges: WorkflowState['edges']): WorkflowState {
  return {
    blocks: Object.fromEntries(blocks.map((block) => [block.id, block])),
    edges,
    loops: {},
    parallels: {},
  }
}

async function insertWorkflow(): Promise<string> {
  const id = generateId()
  const now = new Date()
  await db.insert(workflow).values({
    id,
    userId: ownerId,
    name: 'Normalized save fixture',
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
  return id
}

/** Every stored row of the workflow except the database-stamped timestamps, ordered by id. */
async function storedRows(executor: DbOrTx, workflowId: string) {
  const [blocks, edges, subflows] = await Promise.all([
    executor
      .select()
      .from(workflowBlocks)
      .where(eq(workflowBlocks.workflowId, workflowId))
      .orderBy(asc(workflowBlocks.id)),
    executor
      .select()
      .from(workflowEdges)
      .where(eq(workflowEdges.workflowId, workflowId))
      .orderBy(asc(workflowEdges.id)),
    executor
      .select()
      .from(workflowSubflows)
      .where(eq(workflowSubflows.workflowId, workflowId))
      .orderBy(asc(workflowSubflows.id)),
  ])
  return {
    blocks: blocks.map(({ createdAt, updatedAt, ...row }) => row),
    edges: edges.map(({ createdAt, ...row }) => row),
    subflows: subflows.map(({ createdAt, updatedAt, ...row }) => row),
  }
}

async function blockUpdatedAt(workflowId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ id: workflowBlocks.id, updatedAt: workflowBlocks.updatedAt })
    .from(workflowBlocks)
    .where(eq(workflowBlocks.workflowId, workflowId))
  return new Map(rows.map((row) => [row.id, row.updatedAt.getTime()]))
}

/** The rows the delete-all and re-insert save left: clear the graph, then save into it. */
async function fullReplaceRows(workflowId: string, state: WorkflowState) {
  return db.transaction(async (tx) => {
    await tx.delete(workflowBlocks).where(eq(workflowBlocks.workflowId, workflowId))
    await tx.delete(workflowEdges).where(eq(workflowEdges.workflowId, workflowId))
    await tx.delete(workflowSubflows).where(eq(workflowSubflows.workflowId, workflowId))
    expect(await saveWorkflowToNormalizedTables(workflowId, state, tx)).toEqual({ success: true })
    return storedRows(tx, workflowId)
  })
}

/** One random edit of the kinds a source apply, operations apply or Copilot edit makes. */
function mutate(state: WorkflowState, random: () => number): WorkflowState {
  const blocks = Object.values(state.blocks).map((block) => structuredClone(block))
  let edges = state.edges.map((edge) => ({ ...edge }))
  const pick = <T>(items: T[]): T | undefined => items[Math.floor(random() * items.length)]
  const functions = blocks.filter((block) => block.type === 'function')
  const containers = blocks.filter((block) => block.type !== 'function')
  const edit = Math.floor(random() * 10)

  if (edit === 0 || functions.length < 2) {
    const id = generateId()
    blocks.push(functionBlock(id, `Block ${id.slice(0, 6)}`, Math.floor(random() * 2000)))
  } else if (edit === 1) {
    const removed = pick(blocks)
    if (removed) {
      const gone = new Set([
        removed.id,
        ...blocks.filter((b) => b.data?.parentId === removed.id).map((b) => b.id),
      ])
      edges = edges.filter((edge) => !gone.has(edge.source) && !gone.has(edge.target))
      return stateOf(
        blocks.filter((block) => !gone.has(block.id)),
        edges
      )
    }
  } else if (edit === 9) {
    const replaced = pick(functions)
    if (replaced) {
      const replacement = functionBlock(generateId(), replaced.name, replaced.position.x)
      for (const edge of edges) {
        if (edge.source === replaced.id) edge.source = replacement.id
        if (edge.target === replaced.id) edge.target = replacement.id
      }
      return stateOf([...blocks.filter((block) => block !== replaced), replacement], edges)
    }
  } else if (edit === 2) {
    const target = pick(functions)
    if (target) target.subBlocks.code = { id: 'code', type: 'code', value: `return ${random()}` }
  } else if (edit === 3) {
    const target = pick(blocks)
    if (target) target.position = { x: Math.floor(random() * 2000), y: Math.floor(random() * 900) }
  } else if (edit === 4) {
    const child = pick(functions)
    const container = pick(containers)
    if (child && container) child.data = { parentId: container.id, extent: 'parent' }
    else if (child) child.data = {}
  } else if (edit === 5) {
    const id = generateId()
    blocks.push(containerBlock(id, random() < 0.5 ? 'loop' : 'parallel', `Group ${id.slice(0, 6)}`))
  } else if (edit === 6) {
    const source = pick(blocks)
    const target = pick(blocks)
    if (source && target && source.id !== target.id) {
      edges.push({ id: generateId(), source: source.id, target: target.id })
    }
  } else if (edit === 7) {
    const edge = pick(edges)
    const target = pick(blocks)
    if (edge && target && target.id !== edge.source) {
      edge.target = target.id
      edge.sourceHandle = random() < 0.5 ? 'error' : undefined
    }
  } else {
    const dropped = pick(edges)
    edges = edges.filter((edge) => edge !== dropped)
    const renamed = pick(blocks)
    if (renamed) {
      renamed.name = `${renamed.name}!`
      renamed.enabled = !renamed.enabled
    }
  }
  return stateOf(blocks, edges)
}

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values({
    id: ownerId,
    name: 'Normalized save fixture',
    email: `${ownerId}@normalized-save.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
})

afterAll(async () => {
  await db.delete(user).where(eq(user.id, ownerId))
})

describe('saveWorkflowToNormalizedTables', () => {
  it.each([1, 2, 3, 4])(
    'leaves the rows a full replace leaves across random edit sequences (seed %i)',
    async (seed) => {
      const random = seededRandom(seed)
      const workflowId = await insertWorkflow()
      const loopId = generateId()
      let state = stateOf(
        [
          containerBlock(loopId, 'loop', 'Loop'),
          ...Array.from({ length: 12 }, (_, index) =>
            functionBlock(
              generateId(),
              `Seed ${index}`,
              index * 100,
              index < 3 ? loopId : undefined
            )
          ),
        ],
        []
      )
      expect(await saveWorkflowToNormalizedTables(workflowId, state)).toEqual({ success: true })

      for (let step = 0; step < 40; step++) {
        state = mutate(state, random)
        expect(await saveWorkflowToNormalizedTables(workflowId, state)).toEqual({ success: true })
        const diffed = await storedRows(db, workflowId)
        expect(diffed, `seed ${seed} step ${step}`).toEqual(
          await fullReplaceRows(workflowId, state)
        )
      }
    }
  )

  it('rewrites only the block a one-field edit changed', async () => {
    const workflowId = await insertWorkflow()
    const blocks = Array.from({ length: 20 }, (_, index) =>
      functionBlock(generateId(), `Block ${index}`, index * 100)
    )
    const edges = blocks
      .slice(1)
      .map((block, index) => ({ id: generateId(), source: blocks[index].id, target: block.id }))
    expect(await saveWorkflowToNormalizedTables(workflowId, stateOf(blocks, edges))).toEqual({
      success: true,
    })
    const before = await blockUpdatedAt(workflowId)

    const edited = structuredClone(blocks)
    edited[7].subBlocks.code = { id: 'code', type: 'code', value: 'return 42' }
    expect(await saveWorkflowToNormalizedTables(workflowId, stateOf(edited, edges))).toEqual({
      success: true,
    })

    const after = await blockUpdatedAt(workflowId)
    const rewritten = [...after].filter(([id, at]) => before.get(id) !== at).map(([id]) => id)
    expect(rewritten).toEqual([edited[7].id])
  })

  it('refuses a block id another workflow owns and leaves the stored graph as it was', async () => {
    const owner = await insertWorkflow()
    const workflowId = await insertWorkflow()
    const claimed = functionBlock(generateId(), 'Claimed', 0)
    const kept = functionBlock(generateId(), 'Kept', 0)
    expect(await saveWorkflowToNormalizedTables(owner, stateOf([claimed], []))).toEqual({
      success: true,
    })
    expect(await saveWorkflowToNormalizedTables(workflowId, stateOf([kept], []))).toEqual({
      success: true,
    })
    const before = await storedRows(db, workflowId)

    const refused = await db
      .transaction((tx) => saveWorkflowToNormalizedTables(workflowId, stateOf([claimed], []), tx))
      .then(
        () => undefined,
        (error: unknown) => error
      )

    expect(getPostgresErrorCode(refused)).toBe('23505')
    expect(await storedRows(db, workflowId)).toEqual(before)
    expect((await storedRows(db, owner)).blocks.map((block) => block.name)).toEqual(['Claimed'])
  })
})
