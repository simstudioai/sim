import { db, workflow, workflowBlocks, workflowEdges, workflowSubflows } from '@sim/db'
import { createLogger } from '@sim/logger'
import type { BlockRetryConfig, BlockState, Loop, Parallel } from '@sim/workflow-types/workflow'
import {
  normalizeBlockRetryTries,
  normalizeBlockRetryWaitMs,
  normalizeWorkflowEdgeSourceHandle,
  normalizeWorkflowEdgeTargetHandle,
  SUBFLOW_TYPES,
} from '@sim/workflow-types/workflow'
import type { Edge } from '@xyflow/react'
import { and, asc, eq, getTableColumns, inArray, isNull, type SQLWrapper, sql } from 'drizzle-orm'
import { clampParallelBatchSize } from './subflow-helpers'
import type { DbOrTx, GraphTable, NormalizedWorkflowData } from './types'

const logger = createLogger('WorkflowPersistenceLoad')

/**
 * Rebuilds a stored retry policy as a real {@link BlockRetryConfig} instead of
 * asserting that the raw `jsonb` blob already is one.
 *
 * The column is written verbatim by writers that never validate its contents —
 * the realtime batch-add and replace-state ops take untyped block records, and
 * the admin/superuser import routes persist externally-authored workflow JSON —
 * so a row can hold an out-of-range number, a missing field, or a non-boolean
 * flag. Pinning the values here is the policy the feature declares (see
 * `resolveBlockRetryConfig`) and applies it to every reader at once: the editor
 * renders exactly the numbers execution will use, and the strict HTTP contract
 * that serves this state can never reject a workflow it is meant to open.
 *
 * `enabled` is carried across rather than resolved, so the numbers a builder
 * configured survive switching retry off and back on. That is why
 * `resolveBlockRetryConfig` — which collapses a disabled policy to `null` —
 * must not be used on this path.
 */
/**
 * Stored subflow config coerced to the string the loaded shape declares.
 *
 * `config` is schemaless JSONB and the writers are looser than the readers:
 * `?? ''` only replaces `null`/`undefined`, so an object or number written into
 * `whileCondition` or `doWhileCondition` survived to a consumer whose schema
 * asserts `z.string()`. On the v2 read that is a `500` on a workflow that opens
 * fine in the editor. Non-strings are preserved as JSON rather than dropped, so
 * nothing a caller wrote is lost.
 *
 * `forEachItems` and `distribution` deliberately do NOT go through this: both
 * are declared `unknown[] | Record<string, unknown> | string` in
 * `@sim/workflow-types` and published as that union by the v2 read schema, so a
 * stored array is correct data rather than a shape to coerce.
 */
function storedConfigString(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}

/** Stored subflow `nodes` filtered to the block-id strings the shape declares. */
function storedConfigNodes(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((node): node is string => typeof node === 'string')
    : []
}

function normalizeStoredBlockRetry(stored: unknown): BlockRetryConfig | undefined {
  if (stored == null || typeof stored !== 'object') return undefined
  const retry = stored as Record<string, unknown>

  return {
    enabled: Boolean(retry.enabled),
    maxTries: normalizeBlockRetryTries(retry.maxTries),
    waitBetweenTriesMs: normalizeBlockRetryWaitMs(retry.waitBetweenTriesMs),
  }
}

export interface RawNormalizedWorkflow extends NormalizedWorkflowData {
  workspaceId: string
  /**
   * Each block row's `updated_at` rendered by Postgres as text, preserving the
   * full microsecond precision. Kept as a string on purpose: Drizzle's `date`
   * mode surfaces timestamps as JS `Date`s, which truncate to milliseconds, so
   * a Date-based value can never be used for an exact compare-and-set against
   * rows stamped by SQL `now()`/`defaultNow()`.
   */
  blockUpdatedAtById: Record<string, string | null>
}

/**
 * Load workflow state from normalized tables without running block migrations.
 * Block migrations (credential rewrites, subblock ID migrations, canonical-mode
 * backfill, tool sanitization) depend on the block/tool registry that lives in
 * the Next app and should not be pulled into leaf services. Callers that want
 * migrated state should wrap this with their own migration pipeline.
 *
 * Invariant: downstream migrations must not mutate `block.data.collection`,
 * `block.data.whileCondition`, or `block.data.doWhileCondition`. Those fields
 * are patched here from the subflow config on the pre-migration block, and
 * callers re-sync only `loop.enabled`/`parallel.enabled` from the migrated
 * block. If a future migration rewrites these data fields, the loop/parallel
 * config on the returned object will silently diverge from the migrated block.
 */
export async function loadWorkflowFromNormalizedTablesRaw(
  workflowId: string,
  externalTx?: DbOrTx
): Promise<RawNormalizedWorkflow | null> {
  try {
    const tx = externalTx ?? db
    const [rows, [workflowRow]] = await Promise.all([
      selectGraphRows(tx, [workflowId]),
      tx
        .select({ workspaceId: workflow.workspaceId })
        .from(workflow)
        .where(eq(workflow.id, workflowId))
        .limit(1),
    ])

    if (!workflowRow) return null
    if (!workflowRow.workspaceId) {
      throw new Error(`Workflow ${workflowId} has no workspace`)
    }
    return assembleRawNormalized(workflowRow.workspaceId, rows.blocks, rows.edges, rows.subflows)
  } catch (error) {
    logger.error(`Error loading workflow ${workflowId} from normalized tables:`, error)
    return null
  }
}

/**
 * {@link loadWorkflowFromNormalizedTablesRaw} for many live workflows of one workspace in one query
 * per table, by workflow id. A workflow that is archived or not in `workspaceId` is left out, and
 * its graph rows are never read: each graph query filters by the live in-workspace ids itself.
 */
export async function loadWorkflowsFromNormalizedTablesRaw(
  workflowIds: readonly string[],
  workspaceId: string,
  externalTx?: DbOrTx
): Promise<Map<string, RawNormalizedWorkflow>> {
  const loaded = new Map<string, RawNormalizedWorkflow>()
  if (workflowIds.length === 0) return loaded
  const tx = externalTx ?? db
  const liveIds = () =>
    tx
      .select({ id: workflow.id })
      .from(workflow)
      .where(
        and(
          inArray(workflow.id, [...workflowIds]),
          eq(workflow.workspaceId, workspaceId),
          isNull(workflow.archivedAt)
        )
      )
  const [graph, workflows] = await Promise.all([selectGraphRows(tx, liveIds), liveIds()])
  const byWorkflow = <T extends { workflowId: string }>(items: T[]) => {
    const grouped = new Map<string, T[]>()
    for (const item of items) {
      const group = grouped.get(item.workflowId)
      if (group) group.push(item)
      else grouped.set(item.workflowId, [item])
    }
    return grouped
  }
  const blocksOf = byWorkflow(graph.blocks)
  const edgesOf = byWorkflow(graph.edges)
  const subflowsOf = byWorkflow(graph.subflows)
  for (const { id } of workflows) {
    loaded.set(
      id,
      assembleRawNormalized(
        workspaceId,
        blocksOf.get(id) ?? [],
        edgesOf.get(id) ?? [],
        subflowsOf.get(id) ?? []
      )
    )
  }
  return loaded
}

/**
 * The order a workflow's block, edge or subflow rows load in: creation order. A save stamps the
 * rows it inserts together a microsecond apart, in the order the state listed them, so those rows
 * keep that order however often they are rewritten later. Rows that share one timestamp (older
 * saves, a duplicate, a paste, realtime batch adds) load in physical (`ctid`) order, as they
 * always did: insertion order until a row is rewritten, which moves it to the end of its tie
 * group. The executor reads the order for a condition or router edge with no handle, and the
 * editor for its node order.
 */
export function creationOrder(table: GraphTable) {
  return [asc(table.createdAt), sql`ctid`] as const
}

/**
 * The block, edge and subflow rows of `workflowIds`: a list, or a query of ids that each graph
 * query embeds as a subquery, each in {@link creationOrder}, so the assembled graph's order is a
 * fact of the stored rows, not of the query plan.
 */
async function selectGraphRows(tx: DbOrTx, workflowIds: string[] | (() => SQLWrapper)) {
  const ids = () => (typeof workflowIds === 'function' ? workflowIds() : workflowIds)
  const [blocks, edges, subflows] = await Promise.all([
    tx
      .select({
        ...getTableColumns(workflowBlocks),
        updatedAtText: sql<string | null>`${workflowBlocks.updatedAt}::text`,
      })
      .from(workflowBlocks)
      .where(inArray(workflowBlocks.workflowId, ids()))
      .orderBy(...creationOrder(workflowBlocks)),
    tx
      .select()
      .from(workflowEdges)
      .where(inArray(workflowEdges.workflowId, ids()))
      .orderBy(...creationOrder(workflowEdges)),
    tx
      .select()
      .from(workflowSubflows)
      .where(inArray(workflowSubflows.workflowId, ids()))
      .orderBy(...creationOrder(workflowSubflows)),
  ])
  return { blocks, edges, subflows }
}

type StoredBlockRow = typeof workflowBlocks.$inferSelect & { updatedAtText: string | null }

/** A workflow's normalized rows assembled into its raw graph. */
function assembleRawNormalized(
  workspaceId: string,
  blocks: readonly StoredBlockRow[],
  edges: readonly (typeof workflowEdges.$inferSelect)[],
  subflows: readonly (typeof workflowSubflows.$inferSelect)[]
): RawNormalizedWorkflow {
  const blocksMap: Record<string, BlockState> = {}
  const blockUpdatedAtById: Record<string, string | null> = {}
  blocks.forEach((block) => {
    const blockData = (block.data ?? {}) as BlockState['data']

    const assembled: BlockState = {
      id: block.id,
      type: block.type,
      name: block.name,
      position: {
        x: Number(block.positionX),
        y: Number(block.positionY),
      },
      enabled: block.enabled,
      horizontalHandles: block.horizontalHandles,
      advancedMode: block.advancedMode,
      errorEnabled: block.errorEnabled,
      retry: normalizeStoredBlockRetry(block.retry),
      triggerMode: block.triggerMode,
      height: Number(block.height),
      subBlocks: (block.subBlocks as BlockState['subBlocks']) || {},
      outputs: (block.outputs as BlockState['outputs']) || {},
      data: blockData,
      locked: block.locked,
    }

    blocksMap[block.id] = assembled
    blockUpdatedAtById[block.id] = block.updatedAtText ?? null
  })

  const edgesArray: Edge[] = edges.map((edge) => ({
    id: edge.id,
    source: edge.sourceBlockId,
    target: edge.targetBlockId,
    sourceHandle: normalizeWorkflowEdgeSourceHandle(edge.sourceHandle) ?? undefined,
    targetHandle: normalizeWorkflowEdgeTargetHandle(edge.targetHandle) ?? undefined,
    type: 'default',
    data: {},
  }))

  const loops: Record<string, Loop> = {}
  const parallels: Record<string, Parallel> = {}

  subflows.forEach((subflow) => {
    const config = (subflow.config ?? {}) as Partial<Loop & Parallel>

    if (subflow.type === SUBFLOW_TYPES.LOOP) {
      const loopType =
        (config as Loop).loopType === 'for' ||
        (config as Loop).loopType === 'forEach' ||
        (config as Loop).loopType === 'while' ||
        (config as Loop).loopType === 'doWhile'
          ? (config as Loop).loopType
          : 'for'

      const loop: Loop = {
        id: subflow.id,
        nodes: storedConfigNodes((config as Loop).nodes),
        iterations:
          typeof (config as Loop).iterations === 'number' ? (config as Loop).iterations : 1,
        loopType,
        forEachItems: (config as Loop).forEachItems ?? '',
        whileCondition: storedConfigString((config as Loop).whileCondition),
        doWhileCondition: storedConfigString((config as Loop).doWhileCondition),
        enabled: blocksMap[subflow.id]?.enabled ?? true,
      }
      loops[subflow.id] = loop

      if (blocksMap[subflow.id]) {
        const block = blocksMap[subflow.id]
        blocksMap[subflow.id] = {
          ...block,
          data: {
            ...block.data,
            /** Repair legacy values without changing valid counts used by serialization. */
            ...(block.data?.count !== undefined && typeof block.data.count !== 'number'
              ? { count: loop.iterations }
              : {}),
            collection: loop.forEachItems ?? block.data?.collection ?? '',
            whileCondition: loop.whileCondition ?? block.data?.whileCondition ?? '',
            doWhileCondition: loop.doWhileCondition ?? block.data?.doWhileCondition ?? '',
          },
        }
      }
    } else if (subflow.type === SUBFLOW_TYPES.PARALLEL) {
      const parallel: Parallel = {
        id: subflow.id,
        nodes: storedConfigNodes((config as Parallel).nodes),
        count: typeof (config as Parallel).count === 'number' ? (config as Parallel).count : 5,
        distribution: (config as Parallel).distribution ?? '',
        parallelType:
          (config as Parallel).parallelType === 'count' ||
          (config as Parallel).parallelType === 'collection'
            ? (config as Parallel).parallelType
            : 'count',
        batchSize: clampParallelBatchSize((config as Parallel).batchSize),
        enabled: blocksMap[subflow.id]?.enabled ?? true,
      }
      parallels[subflow.id] = parallel

      if (blocksMap[subflow.id]) {
        const block = blocksMap[subflow.id]
        blocksMap[subflow.id] = {
          ...block,
          data: {
            ...block.data,
            count: parallel.count,
            collection: parallel.distribution ?? block.data?.collection ?? '',
            parallelType: parallel.parallelType,
            batchSize: parallel.batchSize,
          },
        }
      }
    } else {
      logger.warn(`Unknown subflow type: ${subflow.type} for subflow ${subflow.id}`)
    }
  })

  return {
    blocks: blocksMap,
    edges: edgesArray,
    loops,
    parallels,
    isFromNormalizedTables: true,
    workspaceId,
    blockUpdatedAtById,
  }
}

/**
 * Optimistic-concurrency guard: matches a row's `updated_at` exactly against
 * the microsecond-precision text value captured at read time.
 *
 * The comparison deliberately round-trips through text rather than a JS
 * `Date`. Postgres stores `timestamp` columns with microsecond precision, but
 * Drizzle's `date` mode truncates to milliseconds on read, so a Date-based
 * equality guard can never match rows stamped by SQL `now()`/`defaultNow()` —
 * the UPDATE silently no-ops forever and load-time migrations never persist.
 * Casting the captured text back to `timestamp` restores an exact
 * compare-and-set: a concurrent write stamps a new `updated_at` and the guard
 * fails closed (skipped, logged, retried on the next load). Residual, inherent
 * limit: a concurrent app write whose JS `new Date()` collides with the stored
 * value at exact precision is indistinguishable; a version column would be
 * required to close that fully.
 */
function updatedAtMatches(expectedText: string) {
  return eq(workflowBlocks.updatedAt, sql`${expectedText}::timestamp`)
}

export async function persistMigratedBlocks(
  workflowId: string,
  originalBlocks: Record<string, BlockState>,
  migratedBlocks: Record<string, BlockState>,
  blockUpdatedAtById: Record<string, string | null> = {}
): Promise<void> {
  try {
    for (const [blockId, block] of Object.entries(migratedBlocks)) {
      if (block !== originalBlocks[blockId]) {
        const hasExpectedUpdatedAt = Object.hasOwn(blockUpdatedAtById, blockId)
        const expectedUpdatedAt = blockUpdatedAtById[blockId]
        const whereClause = hasExpectedUpdatedAt
          ? and(
              eq(workflowBlocks.id, blockId),
              eq(workflowBlocks.workflowId, workflowId),
              expectedUpdatedAt === null
                ? isNull(workflowBlocks.updatedAt)
                : updatedAtMatches(expectedUpdatedAt)
            )
          : and(eq(workflowBlocks.id, blockId), eq(workflowBlocks.workflowId, workflowId))

        const persisted = await db
          .update(workflowBlocks)
          .set({
            subBlocks: block.subBlocks,
            data: block.data,
            updatedAt: new Date(),
          })
          .where(whereClause)
          .returning({ id: workflowBlocks.id })

        if (persisted.length === 0) {
          logger.warn('Skipped persisting block migration (row changed since read or missing)', {
            workflowId,
            blockId,
            expectedUpdatedAt,
          })
        }
      }
    }
  } catch (err) {
    logger.warn('Failed to persist block migrations', { workflowId, error: err })
  }
}
