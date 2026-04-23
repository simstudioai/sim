import { db, workflow, workflowBlocks, workflowEdges, workflowSubflows } from '@sim/db'
import { createLogger } from '@sim/logger'
import type { BlockState, Loop, Parallel } from '@sim/workflow-types/workflow'
import { SUBFLOW_TYPES } from '@sim/workflow-types/workflow'
import { eq } from 'drizzle-orm'
import type { Edge } from 'reactflow'
import type { NormalizedWorkflowData } from './types'

const logger = createLogger('WorkflowPersistenceLoad')

export interface RawNormalizedWorkflow extends NormalizedWorkflowData {
  workspaceId: string
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
  workflowId: string
): Promise<RawNormalizedWorkflow | null> {
  try {
    const [blocks, edges, subflows, [workflowRow]] = await Promise.all([
      db.select().from(workflowBlocks).where(eq(workflowBlocks.workflowId, workflowId)),
      db.select().from(workflowEdges).where(eq(workflowEdges.workflowId, workflowId)),
      db.select().from(workflowSubflows).where(eq(workflowSubflows.workflowId, workflowId)),
      db
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
          enabled: blocksMap[subflow.id]?.enabled ?? true,
        }
        parallels[subflow.id] = parallel
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
    }
  } catch (error) {
    logger.error(`Error loading workflow ${workflowId} from normalized tables:`, error)
    return null
  }
}

export async function persistMigratedBlocks(
  workflowId: string,
  originalBlocks: Record<string, BlockState>,
  migratedBlocks: Record<string, BlockState>
): Promise<void> {
  try {
    for (const [blockId, block] of Object.entries(migratedBlocks)) {
      if (block !== originalBlocks[blockId]) {
        await db
          .update(workflowBlocks)
          .set({
            subBlocks: block.subBlocks,
            data: block.data,
            updatedAt: new Date(),
          })
          .where(eq(workflowBlocks.id, blockId))
      }
    }
  } catch (err) {
    logger.warn('Failed to persist block migrations', { workflowId, error: err })
  }
}
