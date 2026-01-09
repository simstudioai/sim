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
    case 'batch-add-blocks': {
      const op = operation as BatchAddBlocksOperation
      return {
        ...operation,
        type: 'batch-remove-blocks',
        data: {
          blockSnapshots: op.data.blockSnapshots,
          edgeSnapshots: op.data.edgeSnapshots,
          subBlockValues: op.data.subBlockValues,
        },
      } as BatchRemoveBlocksOperation
    }

    case 'batch-remove-blocks': {
      const op = operation as BatchRemoveBlocksOperation
      return {
        ...operation,
        type: 'batch-add-blocks',
        data: {
          blockSnapshots: op.data.blockSnapshots,
          edgeSnapshots: op.data.edgeSnapshots,
          subBlockValues: op.data.subBlockValues,
        },
      } as BatchAddBlocksOperation
    }

    case 'batch-add-edges': {
      const op = operation as BatchAddEdgesOperation
      return {
        ...operation,
        type: 'batch-remove-edges',
        data: {
          edgeSnapshots: op.data.edgeSnapshots,
        },
      } as BatchRemoveEdgesOperation
    }

    case 'batch-remove-edges': {
      const op = operation as BatchRemoveEdgesOperation
      return {
        ...operation,
        type: 'batch-add-edges',
        data: {
          edgeSnapshots: op.data.edgeSnapshots,
        },
      } as BatchAddEdgesOperation
    }

    case 'batch-move-blocks': {
      const op = operation as BatchMoveBlocksOperation
      return {
        ...operation,
        type: 'batch-move-blocks',
        data: {
          moves: op.data.moves.map((m) => ({
            blockId: m.blockId,
            before: m.after,
            after: m.before,
          })),
        },
      } as BatchMoveBlocksOperation
    }

    case 'update-parent':
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

    case 'batch-update-parent': {
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

    case 'apply-diff':
      return {
        ...operation,
        data: {
          baselineSnapshot: operation.data.proposedState,
          proposedState: operation.data.baselineSnapshot,
          diffAnalysis: operation.data.diffAnalysis,
        },
      }

    case 'accept-diff':
      return {
        ...operation,
        data: {
          beforeAccept: operation.data.afterAccept,
          afterAccept: operation.data.beforeAccept,
          diffAnalysis: operation.data.diffAnalysis,
          baselineSnapshot: operation.data.baselineSnapshot,
        },
      }

    case 'reject-diff':
      return {
        ...operation,
        data: {
          beforeReject: operation.data.afterReject,
          afterReject: operation.data.beforeReject,
          diffAnalysis: operation.data.diffAnalysis,
          baselineSnapshot: operation.data.baselineSnapshot,
        },
      }

    case 'batch-toggle-enabled':
      return {
        ...operation,
        data: {
          blockIds: operation.data.blockIds,
          previousStates: operation.data.previousStates,
        },
      }

    case 'batch-toggle-handles':
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
