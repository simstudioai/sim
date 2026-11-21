import { db, workflowBlocks, workflowEdges, workflowSubflows } from '@sim/db'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { chunkArray } from '@sim/utils/helpers'
import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import {
  normalizeWorkflowEdgeSourceHandle,
  normalizeWorkflowEdgeTargetHandle,
  SUBFLOW_TYPES,
} from '@sim/workflow-types/workflow'
import type { InferInsertModel, SQL } from 'drizzle-orm'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { PgInsertValue } from 'drizzle-orm/pg-core'
import { creationOrder } from './load'
import { pruneWorkflowSourceMeta } from './source-meta'
import { generateLoopBlocks, generateParallelBlocks } from './subflow-helpers'
import type { DbOrTx, GraphTable } from './types'

const logger = createLogger('WorkflowPersistenceSave')

type BlockRow = InferInsertModel<typeof workflowBlocks>
type EdgeRow = InferInsertModel<typeof workflowEdges>
type SubflowRow = InferInsertModel<typeof workflowSubflows>

/**
 * Edges one insert writes: each binds seven parameters, so a workflow's edges at the source limit
 * stay under Postgres's 65,535 per statement.
 */
const EDGE_INSERT_BATCH = 5_000

/** Columns the database stamps; the save never compares them. */
const UNCOMPARED_COLUMNS = new Set(['createdAt', 'updatedAt'])

/** A table's rows split into what the save inserts, rewrites and deletes. */
interface RowPlan<Row> {
  inserts: Row[]
  updates: Row[]
  deleteIds: string[]
}

function toBlockRow(workflowId: string, block: BlockState): BlockRow {
  return {
    id: block.id,
    workflowId,
    type: block.type,
    name: block.name || '',
    positionX: String(block.position?.x || 0),
    positionY: String(block.position?.y || 0),
    enabled: block.enabled ?? true,
    horizontalHandles: block.horizontalHandles ?? true,
    isWide: false,
    advancedMode: block.advancedMode ?? false,
    triggerMode: block.triggerMode ?? false,
    height: String(block.height || 0),
    subBlocks: block.subBlocks || {},
    outputs: block.outputs || {},
    errorEnabled: block.errorEnabled ?? false,
    /**
     * Persisted verbatim, including a disabled policy, so the configured
     * numbers survive switching retry off and back on. Whether it runs is
     * decided by `resolveBlockRetryConfig` at execution time.
     */
    retry: block.retry ?? null,
    data: block.data || {},
    locked: block.locked ?? false,
  }
}

function toSubflowRows(workflowId: string, blocks: Record<string, BlockState>): SubflowRow[] {
  return [
    ...Object.values(generateLoopBlocks(blocks)).map((loop) => ({
      id: loop.id,
      workflowId,
      type: SUBFLOW_TYPES.LOOP,
      config: loop,
    })),
    ...Object.values(generateParallelBlocks(blocks)).map((parallel) => ({
      id: parallel.id,
      workflowId,
      type: SUBFLOW_TYPES.PARALLEL,
      config: parallel,
    })),
  ]
}

function sortedKeys(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
  const record = value as Record<string, unknown>
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, record[key]])
  )
}

/**
 * A column value as it reads back from Postgres: jsonb drops `undefined` members and ignores
 * key order, so both sides serialize to JSON with sorted keys.
 */
function storedForm(value: unknown): string {
  return JSON.stringify(value ?? null, sortedKeys)
}

function rowChanged(stored: Record<string, unknown>, desired: Record<string, unknown>): boolean {
  for (const [column, value] of Object.entries(desired)) {
    if (UNCOMPARED_COLUMNS.has(column)) continue
    if (storedForm(stored[column]) !== storedForm(value)) return true
  }
  return false
}

/**
 * Diffs the desired rows against the stored ones by id. A repeated desired id goes to the
 * inserts, so Postgres refuses it with the same unique violation a full re-insert raised.
 */
function planRows<Row extends { id: string }>(
  stored: readonly (Record<string, unknown> & { id: string })[],
  desired: readonly Row[]
): RowPlan<Row> {
  const storedById = new Map(stored.map((row) => [row.id, row]))
  const seen = new Set<string>()
  const plan: RowPlan<Row> = { inserts: [], updates: [], deleteIds: [] }
  for (const row of desired) {
    const current = storedById.get(row.id)
    if (!current || seen.has(row.id)) {
      plan.inserts.push(row)
    } else if (rowChanged(current, row)) {
      plan.updates.push(row)
    }
    seen.add(row.id)
  }
  for (const row of stored) {
    if (!seen.has(row.id)) plan.deleteIds.push(row.id)
  }
  return plan
}

const BLOCK_UPDATE_SET = {
  type: sql`excluded.type`,
  name: sql`excluded.name`,
  positionX: sql`excluded.position_x`,
  positionY: sql`excluded.position_y`,
  enabled: sql`excluded.enabled`,
  horizontalHandles: sql`excluded.horizontal_handles`,
  isWide: sql`excluded.is_wide`,
  advancedMode: sql`excluded.advanced_mode`,
  triggerMode: sql`excluded.trigger_mode`,
  errorEnabled: sql`excluded.error_enabled`,
  retry: sql`excluded.retry`,
  locked: sql`excluded.locked`,
  height: sql`excluded.height`,
  subBlocks: sql`excluded.sub_blocks`,
  outputs: sql`excluded.outputs`,
  data: sql`excluded.data`,
  updatedAt: sql`now()`,
} as const

const SUBFLOW_UPDATE_SET = {
  type: sql`excluded.type`,
  config: sql`excluded.config`,
  updatedAt: sql`now()`,
} as const

/**
 * Rewrites rows the transaction holds in `workflowId`, one statement per table. The update is
 * confined to this workflow, so a row it skips aborts the save instead of vanishing.
 */
async function updateRows<T extends GraphTable>(
  tx: DbOrTx,
  table: T,
  workflowId: string,
  rows: PgInsertValue<T>[],
  set: Partial<Record<keyof T['$inferInsert'], SQL>>
): Promise<void> {
  if (rows.length === 0) return
  const written = await tx
    .insert(table)
    .values(rows)
    .onConflictDoUpdate({ target: table.id, set, setWhere: eq(table.workflowId, workflowId) })
    .returning({ id: table.id })
  if (written.length !== rows.length) {
    throw new Error(`Failed to update ${rows.length - written.length} stored workflow graph rows`)
  }
}

async function deleteRows(
  tx: DbOrTx,
  table: GraphTable,
  workflowId: string,
  ids: string[]
): Promise<void> {
  if (ids.length === 0) return
  await tx.delete(table).where(and(eq(table.workflowId, workflowId), inArray(table.id, ids)))
}

/**
 * `rows` stamped a microsecond apart in their order, so a save's inserts load back in the order
 * the state listed them (`creationOrder`) rather than by where the heap put them.
 */
function inCreationOrder<T extends object>(
  rows: T[]
): Array<Omit<T, 'createdAt'> & { createdAt: SQL }> {
  return rows.map((row, index) => ({
    ...row,
    createdAt: sql`now() + ${index} * interval '1 microsecond'`,
  }))
}

/**
 * Makes the workflow's normalized block, edge and subflow rows match `state`, leaving the rows a
 * delete-all and re-insert would leave; a state with an edge to a block it does not hold is
 * refused before anything is written, as that re-insert's foreign keys refused it. Only the
 * difference is written for blocks and subflows: rows whose stored columns already match are
 * untouched (keeping their timestamps), changed rows are rewritten, and missing or extra rows are
 * inserted or deleted, so an edit costs its size rather than the graph's. Edges, which nothing
 * references, are left alone when unchanged and in order, and otherwise rewritten whole. Rows
 * inserted together are stamped in the state's order (see `creationOrder`).
 *
 * The stored rows are read `FOR UPDATE`, the rows a delete-all would lock. Writes run in
 * foreign-key order: an edge is retargeted before the block it left is deleted, so that block's
 * `ON DELETE CASCADE` never removes an edge the new state keeps.
 */
export async function saveWorkflowToNormalizedTables(
  workflowId: string,
  state: WorkflowState,
  externalTx?: DbOrTx
): Promise<{ success: boolean; error?: string }> {
  const blockRecords = state.blocks as Record<string, BlockState>
  const desiredBlocks = Object.values(blockRecords).map((block) => toBlockRow(workflowId, block))
  const desiredEdges: EdgeRow[] = state.edges.map((edge) => ({
    id: edge.id,
    workflowId,
    sourceBlockId: edge.source,
    targetBlockId: edge.target,
    sourceHandle: normalizeWorkflowEdgeSourceHandle(edge.sourceHandle) ?? null,
    targetHandle: normalizeWorkflowEdgeTargetHandle(edge.targetHandle) ?? null,
  }))
  const desiredSubflows = toSubflowRows(workflowId, blockRecords)
  const desiredBlockIds = new Set(desiredBlocks.map((block) => block.id))
  const dangling = desiredEdges.find(
    (edge) => !desiredBlockIds.has(edge.sourceBlockId) || !desiredBlockIds.has(edge.targetBlockId)
  )

  const execute = async (tx: DbOrTx) => {
    // The diff keeps an unchanged edge and deletes the block it names, whose cascade would then
    // drop it silently; a full replace refused such a state with a foreign-key violation, so this
    // refuses it before writing anything.
    if (dangling) {
      throw new Error(
        `Edge ${dangling.id} connects a block the saved state does not hold (${dangling.sourceBlockId} → ${dangling.targetBlockId})`
      )
    }
    const [storedBlocks, storedEdges, storedSubflows] = await Promise.all([
      tx
        .select()
        .from(workflowBlocks)
        .where(eq(workflowBlocks.workflowId, workflowId))
        .for('update'),
      tx
        .select()
        .from(workflowEdges)
        .where(eq(workflowEdges.workflowId, workflowId))
        .orderBy(...creationOrder(workflowEdges))
        .for('update'),
      tx
        .select()
        .from(workflowSubflows)
        .where(eq(workflowSubflows.workflowId, workflowId))
        .for('update'),
    ])
    const blocks = planRows(storedBlocks, desiredBlocks)
    const edges = planRows(storedEdges, desiredEdges)
    const subflows = planRows(storedSubflows, desiredSubflows)
    // Edges are rewritten whole, in the state's order, whenever any of them or their order
    // changes: the executor reads a handle-less condition or router edge by its position.
    const rewriteEdges =
      edges.inserts.length + edges.updates.length + edges.deleteIds.length > 0 ||
      storedEdges.some((edge, index) => edge.id !== desiredEdges[index]?.id)

    if (rewriteEdges) {
      await tx.delete(workflowEdges).where(eq(workflowEdges.workflowId, workflowId))
    }
    await deleteRows(tx, workflowSubflows, workflowId, subflows.deleteIds)

    if (blocks.inserts.length > 0) {
      await tx.insert(workflowBlocks).values(inCreationOrder(blocks.inserts))
    }
    await updateRows(tx, workflowBlocks, workflowId, blocks.updates, BLOCK_UPDATE_SET)

    if (rewriteEdges) {
      for (const batch of chunkArray(inCreationOrder(desiredEdges), EDGE_INSERT_BATCH)) {
        await tx.insert(workflowEdges).values(batch)
      }
    }

    await deleteRows(tx, workflowBlocks, workflowId, blocks.deleteIds)

    if (subflows.inserts.length > 0) {
      await tx.insert(workflowSubflows).values(inCreationOrder(subflows.inserts))
    }
    await updateRows(tx, workflowSubflows, workflowId, subflows.updates, SUBFLOW_UPDATE_SET)

    const savedBlockIds = new Set(Object.keys(state.blocks))
    await pruneWorkflowSourceMeta(tx, workflowId, { blocks: (id) => savedBlockIds.has(id) })
  }

  if (externalTx) {
    await execute(externalTx)
    return { success: true }
  }

  try {
    await db.transaction(execute)
    return { success: true }
  } catch (error) {
    logger.error(`Error saving workflow ${workflowId} to normalized tables:`, error)
    return {
      success: false,
      error: toError(error).message,
    }
  }
}
