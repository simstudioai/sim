import { db, workflowBlocks, workflowEdges, workflowSubflows } from '@sim/db'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { SUBFLOW_TYPES } from '@sim/workflow-types/workflow'
import type { InferInsertModel } from 'drizzle-orm'
import { eq } from 'drizzle-orm'
import { generateLoopBlocks, generateParallelBlocks } from './subflow-helpers'
import type { DbOrTx } from './types'

const logger = createLogger('WorkflowPersistenceSave')

type SubflowInsert = InferInsertModel<typeof workflowSubflows>

export async function saveWorkflowToNormalizedTables(
  workflowId: string,
  state: WorkflowState,
  externalTx?: DbOrTx
): Promise<{ success: boolean; error?: string }> {
  const blockRecords = state.blocks as Record<string, BlockState>
  const canonicalLoops = generateLoopBlocks(blockRecords)
  const canonicalParallels = generateParallelBlocks(blockRecords)

  const execute = async (tx: DbOrTx) => {
    await Promise.all([
      tx.delete(workflowBlocks).where(eq(workflowBlocks.workflowId, workflowId)),
      tx.delete(workflowEdges).where(eq(workflowEdges.workflowId, workflowId)),
      tx.delete(workflowSubflows).where(eq(workflowSubflows.workflowId, workflowId)),
    ])

    if (Object.keys(state.blocks).length > 0) {
      const blockInserts = Object.values(state.blocks).map((block) => ({
        id: block.id,
        workflowId,
        type: block.type,
        name: block.name || '',
        positionX: String(block.position?.x || 0),
        positionY: String(block.position?.y || 0),
        enabled: block.enabled ?? true,
        horizontalHandles: block.horizontalHandles ?? true,
        advancedMode: block.advancedMode ?? false,
        triggerMode: block.triggerMode ?? false,
        height: String(block.height || 0),
        subBlocks: block.subBlocks || {},
        outputs: block.outputs || {},
        data: block.data || {},
        parentId: block.data?.parentId || null,
        extent: block.data?.extent || null,
        locked: block.locked ?? false,
      }))

      await tx.insert(workflowBlocks).values(blockInserts)
    }

    if (state.edges.length > 0) {
      const edgeInserts = state.edges.map((edge) => ({
        id: edge.id,
        workflowId,
        sourceBlockId: edge.source,
        targetBlockId: edge.target,
        sourceHandle: edge.sourceHandle || null,
        targetHandle: edge.targetHandle || null,
      }))

      await tx.insert(workflowEdges).values(edgeInserts)
    }

    const subflowInserts: SubflowInsert[] = []

    Object.values(canonicalLoops).forEach((loop) => {
      subflowInserts.push({
        id: loop.id,
        workflowId,
        type: SUBFLOW_TYPES.LOOP,
        config: loop,
      })
    })

    Object.values(canonicalParallels).forEach((parallel) => {
      subflowInserts.push({
        id: parallel.id,
        workflowId,
        type: SUBFLOW_TYPES.PARALLEL,
        config: parallel,
      })
    })

    if (subflowInserts.length > 0) {
      await tx.insert(workflowSubflows).values(subflowInserts)
    }
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
