import type { Operation, OperationEntry } from '@/stores/undo-redo/types'

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
    case 'add-block':
      return {
        ...operation,
        type: 'remove-block',
        data: {
          blockId: operation.data.blockId,
          blockSnapshot: null,
          edgeSnapshots: [],
        },
      }

    case 'remove-block':
      return {
        ...operation,
        type: 'add-block',
        data: {
          blockId: operation.data.blockId,
        },
      }

    case 'add-edge':
      return {
        ...operation,
        type: 'remove-edge',
        data: {
          edgeId: operation.data.edgeId,
          edgeSnapshot: null,
        },
      }

    case 'remove-edge':
      return {
        ...operation,
        type: 'add-edge',
        data: {
          edgeId: operation.data.edgeId,
        },
      }

    case 'add-subflow':
      return {
        ...operation,
        type: 'remove-subflow',
        data: {
          subflowId: operation.data.subflowId,
          subflowSnapshot: null,
        },
      }

    case 'remove-subflow':
      return {
        ...operation,
        type: 'add-subflow',
        data: {
          subflowId: operation.data.subflowId,
        },
      }

    case 'move-block':
      return {
        ...operation,
        data: {
          blockId: operation.data.blockId,
          before: operation.data.after,
          after: operation.data.before,
        },
      }

    case 'move-subflow':
      return {
        ...operation,
        data: {
          subflowId: operation.data.subflowId,
          before: operation.data.after,
          after: operation.data.before,
        },
      }

    case 'duplicate-block':
      return {
        ...operation,
        type: 'remove-block',
        data: {
          blockId: operation.data.duplicatedBlockId,
          blockSnapshot: operation.data.duplicatedBlockSnapshot,
          edgeSnapshots: [],
        },
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

    default: {
      const exhaustiveCheck: never = operation
      throw new Error(`Unhandled operation type: ${(exhaustiveCheck as any).type}`)
    }
  }
}

export function operationToCollaborativePayload(operation: Operation): {
  operation: string
  target: string
  payload: any
} {
  switch (operation.type) {
    case 'add-block':
      return {
        operation: 'add',
        target: 'block',
        payload: { id: operation.data.blockId },
      }

    case 'remove-block':
      return {
        operation: 'remove',
        target: 'block',
        payload: { id: operation.data.blockId },
      }

    case 'add-edge':
      return {
        operation: 'add',
        target: 'edge',
        payload: { id: operation.data.edgeId },
      }

    case 'remove-edge':
      return {
        operation: 'remove',
        target: 'edge',
        payload: { id: operation.data.edgeId },
      }

    case 'add-subflow':
      return {
        operation: 'add',
        target: 'subflow',
        payload: { id: operation.data.subflowId },
      }

    case 'remove-subflow':
      return {
        operation: 'remove',
        target: 'subflow',
        payload: { id: operation.data.subflowId },
      }

    case 'move-block':
      return {
        operation: 'update-position',
        target: 'block',
        payload: {
          id: operation.data.blockId,
          x: operation.data.after.x,
          y: operation.data.after.y,
          parentId: operation.data.after.parentId,
        },
      }

    case 'move-subflow':
      return {
        operation: 'update-position',
        target: 'subflow',
        payload: {
          id: operation.data.subflowId,
          x: operation.data.after.x,
          y: operation.data.after.y,
        },
      }

    case 'duplicate-block':
      return {
        operation: 'duplicate',
        target: 'block',
        payload: {
          sourceId: operation.data.sourceBlockId,
          duplicatedId: operation.data.duplicatedBlockId,
        },
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

    default: {
      const exhaustiveCheck: never = operation
      throw new Error(`Unhandled operation type: ${(exhaustiveCheck as any).type}`)
    }
  }
}
