import type {
  BatchAddBlocksOperation,
  BatchAddEdgesOperation,
  BatchMoveBlocksOperation,
  BatchRemoveBlocksOperation,
  BatchRemoveEdgesOperation,
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

    case 'add-edge':
      // Note: add-edge only stores edgeId. The full edge snapshot is stored
      // in the inverse operation when recording. This function can't create
      // a complete inverse without the snapshot.
      return {
        ...operation,
        type: 'batch-remove-edges',
        data: {
          edgeSnapshots: [],
        },
      } as BatchRemoveEdgesOperation

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

export function operationToCollaborativePayload(operation: Operation): {
  operation: string
  target: string
  payload: Record<string, unknown>
} {
  switch (operation.type) {
    case 'batch-add-blocks': {
      const op = operation as BatchAddBlocksOperation
      return {
        operation: 'batch-add-blocks',
        target: 'blocks',
        payload: {
          blocks: op.data.blockSnapshots,
          edges: op.data.edgeSnapshots,
          loops: {},
          parallels: {},
          subBlockValues: op.data.subBlockValues,
        },
      }
    }

    case 'batch-remove-blocks': {
      const op = operation as BatchRemoveBlocksOperation
      return {
        operation: 'batch-remove-blocks',
        target: 'blocks',
        payload: { ids: op.data.blockSnapshots.map((b) => b.id) },
      }
    }

    case 'add-edge':
      return {
        operation: 'add',
        target: 'edge',
        payload: { id: operation.data.edgeId },
      }

    case 'batch-add-edges': {
      const op = operation as BatchAddEdgesOperation
      return {
        operation: 'batch-add-edges',
        target: 'edges',
        payload: {
          edges: op.data.edgeSnapshots.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            sourceHandle: e.sourceHandle ?? null,
            targetHandle: e.targetHandle ?? null,
          })),
        },
      }
    }

    case 'batch-remove-edges': {
      const op = operation as BatchRemoveEdgesOperation
      return {
        operation: 'batch-remove-edges',
        target: 'edges',
        payload: { ids: op.data.edgeSnapshots.map((e) => e.id) },
      }
    }

    case 'batch-move-blocks': {
      const op = operation as BatchMoveBlocksOperation
      return {
        operation: 'batch-update-positions',
        target: 'blocks',
        payload: {
          moves: op.data.moves.map((m) => ({
            id: m.blockId,
            x: m.after.x,
            y: m.after.y,
            parentId: m.after.parentId,
          })),
        },
      }
    }

    case 'update-parent':
      return {
        operation: 'update-parent',
        target: 'block',
        payload: {
          id: operation.data.blockId,
          parentId: operation.data.newParentId,
          x: operation.data.newPosition.x,
          y: operation.data.newPosition.y,
        },
      }

    case 'apply-diff':
      return {
        operation: 'apply-diff',
        target: 'workflow',
        payload: {
          diffAnalysis: operation.data.diffAnalysis,
        },
      }

    case 'accept-diff':
      return {
        operation: 'accept-diff',
        target: 'workflow',
        payload: {
          diffAnalysis: operation.data.diffAnalysis,
        },
      }

    case 'reject-diff':
      return {
        operation: 'reject-diff',
        target: 'workflow',
        payload: {
          diffAnalysis: operation.data.diffAnalysis,
        },
      }

    case 'batch-toggle-enabled':
      return {
        operation: 'batch-toggle-enabled',
        target: 'blocks',
        payload: {
          blockIds: operation.data.blockIds,
          previousStates: operation.data.previousStates,
        },
      }

    case 'batch-toggle-handles':
      return {
        operation: 'batch-toggle-handles',
        target: 'blocks',
        payload: {
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
