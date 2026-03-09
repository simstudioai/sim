import type { Edge } from 'reactflow'
import { UNDO_REDO_OPERATIONS } from '@/socket/constants'
import type {
  BatchAddBlocksOperation,
  BatchAddEdgesOperation,
  BatchMoveBlocksOperation,
  BatchRemoveBlocksOperation,
  BatchRemoveEdgesOperation,
  BatchUpdateParentOperation,
  Operation,
  OperationEntry,
} from '@/stores/undo-redo/types'
import { mergeSubblockState } from '@/stores/workflows/utils'
import type { BlockState } from '@/stores/workflows/workflow/types'

export function createOperationEntry(operation: Operation, inverse: Operation): OperationEntry {
  return {
    id: crypto.randomUUID(),
    operation,
    inverse,
    createdAt: Date.now(),
  }
}

export function createInverseOperation(operation: Operation): Operation {
  switch (operation.type) {
    case UNDO_REDO_OPERATIONS.BATCH_ADD_BLOCKS: {
      const op = operation as BatchAddBlocksOperation
      return {
        ...operation,
        type: UNDO_REDO_OPERATIONS.BATCH_REMOVE_BLOCKS,
        data: {
          blockSnapshots: op.data.blockSnapshots,
          edgeSnapshots: op.data.edgeSnapshots,
          subBlockValues: op.data.subBlockValues,
        },
      } as BatchRemoveBlocksOperation
    }

    case UNDO_REDO_OPERATIONS.BATCH_REMOVE_BLOCKS: {
      const op = operation as BatchRemoveBlocksOperation
      return {
        ...operation,
        type: UNDO_REDO_OPERATIONS.BATCH_ADD_BLOCKS,
        data: {
          blockSnapshots: op.data.blockSnapshots,
          edgeSnapshots: op.data.edgeSnapshots,
          subBlockValues: op.data.subBlockValues,
        },
      } as BatchAddBlocksOperation
    }

    case UNDO_REDO_OPERATIONS.BATCH_ADD_EDGES: {
      const op = operation as BatchAddEdgesOperation
      return {
        ...operation,
        type: UNDO_REDO_OPERATIONS.BATCH_REMOVE_EDGES,
        data: {
          edgeSnapshots: op.data.edgeSnapshots,
        },
      } as BatchRemoveEdgesOperation
    }

    case UNDO_REDO_OPERATIONS.BATCH_REMOVE_EDGES: {
      const op = operation as BatchRemoveEdgesOperation
      return {
        ...operation,
        type: UNDO_REDO_OPERATIONS.BATCH_ADD_EDGES,
        data: {
          edgeSnapshots: op.data.edgeSnapshots,
        },
      } as BatchAddEdgesOperation
    }

    case UNDO_REDO_OPERATIONS.BATCH_MOVE_BLOCKS: {
      const op = operation as BatchMoveBlocksOperation
      return {
        ...operation,
        type: UNDO_REDO_OPERATIONS.BATCH_MOVE_BLOCKS,
        data: {
          moves: op.data.moves.map((m) => ({
            blockId: m.blockId,
            before: m.after,
            after: m.before,
          })),
        },
      } as BatchMoveBlocksOperation
    }

    case UNDO_REDO_OPERATIONS.UPDATE_PARENT:
      return {
        ...operation,
        data: {
          blockId: operation.data.blockId,
          oldParentId: operation.data.newParentId,
          newParentId: operation.data.oldParentId,
          oldPosition: operation.data.newPosition,
          newPosition: operation.data.oldPosition,
          affectedEdges: operation.data.affectedEdges,
        },
      }

    case UNDO_REDO_OPERATIONS.BATCH_UPDATE_PARENT: {
      const op = operation as BatchUpdateParentOperation
      return {
        ...operation,
        data: {
          updates: op.data.updates.map((u) => ({
            blockId: u.blockId,
            oldParentId: u.newParentId,
            newParentId: u.oldParentId,
            oldPosition: u.newPosition,
            newPosition: u.oldPosition,
            affectedEdges: u.affectedEdges,
          })),
        },
      } as BatchUpdateParentOperation
    }

    case UNDO_REDO_OPERATIONS.APPLY_DIFF:
      return {
        ...operation,
        data: {
          baselineSnapshot: operation.data.proposedState,
          proposedState: operation.data.baselineSnapshot,
          diffAnalysis: operation.data.diffAnalysis,
        },
      }

    case UNDO_REDO_OPERATIONS.ACCEPT_DIFF:
      return {
        ...operation,
        data: {
          beforeAccept: operation.data.afterAccept,
          afterAccept: operation.data.beforeAccept,
          diffAnalysis: operation.data.diffAnalysis,
          baselineSnapshot: operation.data.baselineSnapshot,
        },
      }

    case UNDO_REDO_OPERATIONS.REJECT_DIFF:
      return {
        ...operation,
        data: {
          beforeReject: operation.data.afterReject,
          afterReject: operation.data.beforeReject,
          diffAnalysis: operation.data.diffAnalysis,
          baselineSnapshot: operation.data.baselineSnapshot,
        },
      }

    case UNDO_REDO_OPERATIONS.BATCH_TOGGLE_ENABLED:
      return {
        ...operation,
        data: {
          blockIds: operation.data.blockIds,
          previousStates: operation.data.previousStates,
        },
      }

    case UNDO_REDO_OPERATIONS.BATCH_TOGGLE_HANDLES:
      return {
        ...operation,
        data: {
          blockIds: operation.data.blockIds,
          previousStates: operation.data.previousStates,
        },
      }

    case UNDO_REDO_OPERATIONS.BATCH_TOGGLE_LOCKED:
      return {
        ...operation,
        data: {
          blockIds: operation.data.blockIds,
          previousStates: operation.data.previousStates,
        },
      }

    default: {
      const exhaustiveCheck: never = operation
      throw new Error(`Unhandled operation type: ${(exhaustiveCheck as Operation).type}`)
    }
  }
}

export function captureLatestEdges(edges: Edge[], blockIds: string[]): Edge[] {
  return edges.filter((e) => blockIds.includes(e.source) || blockIds.includes(e.target))
}

export function captureLatestSubBlockValues(
  blocks: Record<string, BlockState>,
  workflowId: string,
  blockIds: string[]
): Record<string, Record<string, unknown>> {
  const values: Record<string, Record<string, unknown>> = {}
  blockIds.forEach((blockId) => {
    const merged = mergeSubblockState(blocks, workflowId, blockId)
    const block = merged[blockId]
    if (block?.subBlocks) {
      const blockValues: Record<string, unknown> = {}
      Object.entries(block.subBlocks).forEach(([subBlockId, subBlock]) => {
        if (subBlock.value !== null && subBlock.value !== undefined) {
          blockValues[subBlockId] = subBlock.value
        }
      })
      if (Object.keys(blockValues).length > 0) {
        values[blockId] = blockValues
      }
    }
  })
  return values
}
