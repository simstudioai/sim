/**
 * The normalized-table save against real Postgres. It writes only the difference between the
 * stored graph and the new one, and must leave exactly the rows a delete-all and re-insert would:
 * random edit sequences (add, remove, modify, move into a subflow, retarget and drop edges, replace a block
 * under the edges it keeps) are
 * saved both ways and the rows compared. A one-field edit rewrites one row, and an id owned by another
 * workflow is still refused with the unique violation callers map to a conflict, as are an edge id
 * repeated in one state and an edge to a block the state does not hold.
 */
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
import { getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { loadWorkflowFromNormalizedTablesRaw } from '@sim/workflow-persistence/load'
import { saveWorkflowToNormalizedTables } from '@sim/workflow-persistence/save'
import type { DbOrTx } from '@sim/workflow-persistence/types'
import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const ownerId = generateId()
const workspaceId = generateId()

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
    workspaceId,
    name: `Normalized save fixture ${id}`,
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

/**
 * One random edit of the kinds a source apply, operations apply or Copilot edit makes, a retype
 * under the same id included.
 */
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
    if (!target) return stateOf(blocks, edges)
    if (random() < 0.5) {
      target.subBlocks.code = { id: 'code', type: 'code', value: `return ${random()}` }
    } else {
      target.type = 'api'
      target.subBlocks = { url: { id: 'url', type: 'short-input', value: 'https://example.com' } }
    }
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
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    name: 'Normalized save fixture',
    ownerId,
    billedAccountUserId: ownerId,
  })
})

afterAll(async () => {
  await deleteWorkspaceFixture(db, eq(workspace.ownerId, ownerId))
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
        // Real applies batch edits, and the risky orderings come from combinations of them.
        const edits = 1 + Math.floor(random() * 5)
        for (let applied = 0; applied < edits; applied++) state = mutate(state, random)
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

  it('loads blocks and edges in creation order, whatever rows a later save rewrote', async () => {
    const workflowId = await insertWorkflow()
    const blocks = ['b1', 'b2', 'b3'].map((id, index) =>
      functionBlock(`${workflowId}-${id}`, `Block ${index}`, index * 100)
    )
    const [first, second, third] = blocks.map((block) => block.id)
    const edges = [
      { id: `${workflowId}-e1`, source: first, target: third },
      { id: `${workflowId}-e2`, source: second, target: third },
    ]
    expect(await saveWorkflowToNormalizedTables(workflowId, stateOf(blocks, edges))).toEqual({
      success: true,
    })

    const edited = structuredClone(blocks)
    edited[0].name = 'Renamed'
    const added = { id: `${workflowId}-e0`, source: first, target: second }
    const editedEdges = [{ ...edges[0], sourceHandle: 'error' }, edges[1], added]
    expect(await saveWorkflowToNormalizedTables(workflowId, stateOf(edited, editedEdges))).toEqual({
      success: true,
    })
    const loaded = await loadWorkflowFromNormalizedTablesRaw(workflowId)

    expect(Object.keys(loaded?.blocks ?? {})).toEqual([first, second, third])
    expect(loaded?.edges.map((edge) => edge.id)).toEqual([edges[0].id, edges[1].id, added.id])
  })

  it('loads edges saved together in the order the state listed them, not by id', async () => {
    const workflowId = await insertWorkflow()
    const blocks = ['b1', 'b2', 'b3'].map((id, index) =>
      functionBlock(`${workflowId}-${id}`, `Block ${index}`, index * 100)
    )
    const [first, second, third] = blocks.map((block) => block.id)
    const edges = [
      { id: `${workflowId}-z`, source: first, target: second },
      { id: `${workflowId}-a`, source: first, target: third },
    ]
    expect(await saveWorkflowToNormalizedTables(workflowId, stateOf(blocks, edges))).toEqual({
      success: true,
    })

    const loaded = await loadWorkflowFromNormalizedTablesRaw(workflowId)

    expect(loaded?.edges.map((edge) => edge.id)).toEqual(edges.map((edge) => edge.id))
  })

  it('loads edges an older save wrote with one timestamp in the order they were inserted', async () => {
    const workflowId = await insertWorkflow()
    const blocks = ['b1', 'b2', 'b3'].map((id, index) =>
      functionBlock(`${workflowId}-${id}`, `Block ${index}`, index * 100)
    )
    const [first, second, third] = blocks.map((block) => block.id)
    expect(await saveWorkflowToNormalizedTables(workflowId, stateOf(blocks, []))).toEqual({
      success: true,
    })
    const createdAt = new Date()
    await db.insert(workflowEdges).values([
      { id: `${workflowId}-z`, workflowId, sourceBlockId: first, targetBlockId: second, createdAt },
      { id: `${workflowId}-a`, workflowId, sourceBlockId: first, targetBlockId: third, createdAt },
    ])

    const loaded = await loadWorkflowFromNormalizedTablesRaw(workflowId)

    expect(loaded?.edges.map((edge) => edge.id)).toEqual([`${workflowId}-z`, `${workflowId}-a`])
  })

  it('loads blocks and subflows saved together in the order the state listed them, whatever a later save rewrote', async () => {
    const workflowId = await insertWorkflow()
    const blocks = [
      containerBlock(`${workflowId}-z-loop`, 'loop', 'Z loop'),
      containerBlock(`${workflowId}-a-loop`, 'loop', 'A loop'),
      functionBlock(`${workflowId}-y`, 'Y', 0),
      functionBlock(`${workflowId}-b`, 'B', 100),
    ]
    expect(await saveWorkflowToNormalizedTables(workflowId, stateOf(blocks, []))).toEqual({
      success: true,
    })

    const edited = structuredClone(blocks)
    edited[0].name = 'Renamed'
    edited[2].position = { x: 50, y: 50 }
    expect(await saveWorkflowToNormalizedTables(workflowId, stateOf(edited, []))).toEqual({
      success: true,
    })
    const loaded = await loadWorkflowFromNormalizedTablesRaw(workflowId)

    expect(Object.keys(loaded?.blocks ?? {})).toEqual(blocks.map((block) => block.id))
    expect(Object.keys(loaded?.loops ?? {})).toEqual([blocks[0].id, blocks[1].id])
  })

  it('loads blocks and subflows an older save wrote with one timestamp in the order they were inserted', async () => {
    const workflowId = await insertWorkflow()
    const createdAt = new Date()
    const [zLoop, aLoop] = [`${workflowId}-z-loop`, `${workflowId}-a-loop`]
    await db.insert(workflowBlocks).values(
      [zLoop, aLoop].map((id) => ({
        id,
        workflowId,
        type: 'loop',
        name: id,
        positionX: '0',
        positionY: '0',
        createdAt,
      }))
    )
    await db.insert(workflowSubflows).values(
      [zLoop, aLoop].map((id) => ({
        id,
        workflowId,
        type: 'loop',
        config: { id, nodes: [], iterations: 1, loopType: 'for' },
        createdAt,
      }))
    )

    const loaded = await loadWorkflowFromNormalizedTablesRaw(workflowId)

    expect(Object.keys(loaded?.blocks ?? {})).toEqual([zLoop, aLoop])
    expect(Object.keys(loaded?.loops ?? {})).toEqual([zLoop, aLoop])
  })

  it('saves and reloads a workflow at the 10,000-edge source limit, in order', async () => {
    const workflowId = await insertWorkflow()
    const blocks = ['b1', 'b2'].map((id, index) =>
      functionBlock(`${workflowId}-${id}`, `Block ${index}`, index * 100)
    )
    const [first, second] = blocks.map((block) => block.id)
    const edges = Array.from({ length: 10_000 }, (_, index) => ({
      id: `${workflowId}-e${String(9_999 - index).padStart(5, '0')}`,
      source: first,
      target: second,
    }))

    expect(await saveWorkflowToNormalizedTables(workflowId, stateOf(blocks, edges))).toEqual({
      success: true,
    })
    const loaded = await loadWorkflowFromNormalizedTablesRaw(workflowId)

    expect(loaded?.edges.map((edge) => edge.id)).toEqual(edges.map((edge) => edge.id))
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

  it('refuses an edge id another workflow owns and leaves the stored graph as it was', async () => {
    const owner = await insertWorkflow()
    const workflowId = await insertWorkflow()
    const [a, b] = [functionBlock(generateId(), 'A', 0), functionBlock(generateId(), 'B', 100)]
    const [c, d] = [functionBlock(generateId(), 'C', 0), functionBlock(generateId(), 'D', 100)]
    const edgeId = generateId()
    await saveWorkflowToNormalizedTables(
      owner,
      stateOf([a, b], [{ id: edgeId, source: a.id, target: b.id }])
    )
    await saveWorkflowToNormalizedTables(workflowId, stateOf([c, d], []))
    const before = await storedRows(db, workflowId)

    const refused = await db
      .transaction((tx) =>
        saveWorkflowToNormalizedTables(
          workflowId,
          stateOf([c, d], [{ id: edgeId, source: c.id, target: d.id }]),
          tx
        )
      )
      .then(
        () => undefined,
        (error: unknown) => error
      )

    expect(getPostgresErrorCode(refused)).toBe('23505')
    expect(await storedRows(db, workflowId)).toEqual(before)
  })

  it('refuses a state repeating a stored edge id, with the unique violation and nothing written', async () => {
    const workflowId = await insertWorkflow()
    const [a, b, c] = ['A', 'B', 'C'].map((name, index) =>
      functionBlock(generateId(), name, index * 100)
    )
    const edgeId = generateId()
    await saveWorkflowToNormalizedTables(
      workflowId,
      stateOf([a, b, c], [{ id: edgeId, source: a.id, target: b.id }])
    )
    const before = await storedRows(db, workflowId)

    const refused = await db
      .transaction((tx) =>
        saveWorkflowToNormalizedTables(
          workflowId,
          stateOf(
            [a, b, c],
            [
              { id: edgeId, source: a.id, target: b.id },
              { id: edgeId, source: b.id, target: c.id },
            ]
          ),
          tx
        )
      )
      .then(
        () => undefined,
        (error: unknown) => error
      )

    expect(getPostgresErrorCode(refused)).toBe('23505')
    expect(await storedRows(db, workflowId)).toEqual(before)
  })

  it('refuses an edge to a block the state removes, as a full replace did, and writes nothing', async () => {
    const workflowId = await insertWorkflow()
    const [a, b] = [functionBlock(generateId(), 'A', 0), functionBlock(generateId(), 'B', 100)]
    const edges = [{ id: generateId(), source: a.id, target: b.id }]
    expect(await saveWorkflowToNormalizedTables(workflowId, stateOf([a, b], edges))).toEqual({
      success: true,
    })
    const before = await storedRows(db, workflowId)

    const saved = await saveWorkflowToNormalizedTables(workflowId, stateOf([a], edges))

    expect(saved.success).toBe(false)
    expect(await storedRows(db, workflowId)).toEqual(before)
  })
})
