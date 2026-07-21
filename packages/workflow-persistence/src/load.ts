import { db, workflow, workflowBlocks, workflowEdges, workflowSubflows } from '@sim/db'
import { createLogger } from '@sim/logger'
import type { BlockState, Loop, Parallel } from '@sim/workflow-types/workflow'
import { SUBFLOW_TYPES } from '@sim/workflow-types/workflow'
import { and, eq, getTableColumns, isNull, sql } from 'drizzle-orm'
import type { Edge } from 'reactflow'
import { clampParallelBatchSize } from './subflow-helpers'
import type { DbOrTx, NormalizedWorkflowData } from './types'

const logger = createLogger('WorkflowPersistenceLoad')

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
    const [blocks, edges, subflows, [workflowRow]] = await Promise.all([
      tx
        .select({
          ...getTableColumns(workflowBlocks),
          updatedAtText: sql<string | null>`${workflowBlocks.updatedAt}::text`,
        })
        .from(workflowBlocks)
        .where(eq(workflowBlocks.workflowId, workflowId)),
      tx.select().from(workflowEdges).where(eq(workflowEdges.workflowId, workflowId)),
      tx.select().from(workflowSubflows).where(eq(workflowSubflows.workflowId, workflowId)),
      tx
        .select({ workspaceId: workflow.workspaceId })
        .from(workflow)
        .where(eq(workflow.id, workflowId))
        .limit(1),
    ])

    if (blocks.length === 0) {
      return null
    }

    if (!workflowRow?.workspaceId) {
      throw new Error(`Workflow ${workflowId} has no workspace`)
    }

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
      sourceHandle: edge.sourceHandle ?? undefined,
      targetHandle: edge.targetHandle ?? undefined,
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
          nodes: Array.isArray((config as Loop).nodes) ? (config as Loop).nodes : [],
          iterations:
            typeof (config as Loop).iterations === 'number' ? (config as Loop).iterations : 1,
          loopType,
          forEachItems: (config as Loop).forEachItems ?? '',
          whileCondition: (config as Loop).whileCondition ?? '',
          doWhileCondition: (config as Loop).doWhileCondition ?? '',
          enabled: blocksMap[subflow.id]?.enabled ?? true,
        }
        loops[subflow.id] = loop

        if (blocksMap[subflow.id]) {
          const block = blocksMap[subflow.id]
          blocksMap[subflow.id] = {
            ...block,
            data: {
              ...block.data,
              collection: loop.forEachItems ?? block.data?.collection ?? '',
              whileCondition: loop.whileCondition ?? block.data?.whileCondition ?? '',
              doWhileCondition: loop.doWhileCondition ?? block.data?.doWhileCondition ?? '',
            },
          }
        }
      } else if (subflow.type === SUBFLOW_TYPES.PARALLEL) {
        const parallel: Parallel = {
          id: subflow.id,
          nodes: Array.isArray((config as Parallel).nodes) ? (config as Parallel).nodes : [],
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
      workspaceId: workflowRow.workspaceId,
      blockUpdatedAtById,
    }
  } catch (error) {
    logger.error(`Error loading workflow ${workflowId} from normalized tables:`, error)
    return null
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
