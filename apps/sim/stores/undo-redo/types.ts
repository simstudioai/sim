import type { Edge } from 'reactflow'
import type { BlockState } from '@/stores/workflows/workflow/types'

export type OperationType =
  | 'batch-add-blocks'
  | 'batch-remove-blocks'
  | 'add-edge'
  | 'remove-edge'
  | 'add-subflow'
  | 'remove-subflow'
  | 'move-block'
  | 'move-subflow'
  | 'update-parent'
  | 'apply-diff'
  | 'accept-diff'
  | 'reject-diff'

export interface BaseOperation {
  id: string
  type: OperationType
  timestamp: number
  workflowId: string
  userId: string
}

export interface BatchAddBlocksOperation extends BaseOperation {
  type: 'batch-add-blocks'
  data: {
    blockSnapshots: BlockState[]
    edgeSnapshots: Edge[]
    subBlockValues: Record<string, Record<string, unknown>>
  }
}

export interface BatchRemoveBlocksOperation extends BaseOperation {
  type: 'batch-remove-blocks'
  data: {
    blockSnapshots: BlockState[]
    edgeSnapshots: Edge[]
    subBlockValues: Record<string, Record<string, unknown>>
  }
}

export interface AddEdgeOperation extends BaseOperation {
  type: 'add-edge'
  data: {
    edgeId: string
  }
}

export interface RemoveEdgeOperation extends BaseOperation {
  type: 'remove-edge'
  data: {
    edgeId: string
    edgeSnapshot: Edge | null
  }
}

export interface AddSubflowOperation extends BaseOperation {
  type: 'add-subflow'
  data: {
    subflowId: string
  }
}

export interface RemoveSubflowOperation extends BaseOperation {
  type: 'remove-subflow'
  data: {
    subflowId: string
    subflowSnapshot: BlockState | null
  }
}

export interface MoveBlockOperation extends BaseOperation {
  type: 'move-block'
  data: {
    blockId: string
    before: {
      x: number
      y: number
      parentId?: string
    }
    after: {
      x: number
      y: number
      parentId?: string
    }
  }
}

export interface MoveSubflowOperation extends BaseOperation {
  type: 'move-subflow'
  data: {
    subflowId: string
    before: {
      x: number
      y: number
    }
    after: {
      x: number
      y: number
    }
  }
}

export interface UpdateParentOperation extends BaseOperation {
  type: 'update-parent'
  data: {
    blockId: string
    oldParentId?: string
    newParentId?: string
    oldPosition: { x: number; y: number }
    newPosition: { x: number; y: number }
    affectedEdges?: Edge[]
  }
}

export interface ApplyDiffOperation extends BaseOperation {
  type: 'apply-diff'
  data: {
    baselineSnapshot: any // WorkflowState snapshot before diff
    proposedState: any // WorkflowState with diff applied
    diffAnalysis: any // DiffAnalysis for re-applying markers
  }
}

export interface AcceptDiffOperation extends BaseOperation {
  type: 'accept-diff'
  data: {
    beforeAccept: any // WorkflowState with diff markers
    afterAccept: any // WorkflowState without diff markers
    diffAnalysis: any // DiffAnalysis to restore markers on undo
    baselineSnapshot: any // Baseline workflow state
  }
}

export interface RejectDiffOperation extends BaseOperation {
  type: 'reject-diff'
  data: {
    beforeReject: any // WorkflowState with diff markers
    afterReject: any // WorkflowState baseline (after reject)
    diffAnalysis: any // DiffAnalysis to restore markers on undo
    baselineSnapshot: any // Baseline workflow state
  }
}

export type Operation =
  | BatchAddBlocksOperation
  | BatchRemoveBlocksOperation
  | AddEdgeOperation
  | RemoveEdgeOperation
  | AddSubflowOperation
  | RemoveSubflowOperation
  | MoveBlockOperation
  | MoveSubflowOperation
  | UpdateParentOperation
  | ApplyDiffOperation
  | AcceptDiffOperation
  | RejectDiffOperation

export interface OperationEntry {
  id: string
  operation: Operation
  inverse: Operation
  createdAt: number
}

export interface UndoRedoState {
  stacks: Record<
    string,
    {
      undo: OperationEntry[]
      redo: OperationEntry[]
      lastUpdated?: number
    }
  >
  capacity: number
  push: (workflowId: string, userId: string, entry: OperationEntry) => void
  undo: (workflowId: string, userId: string) => OperationEntry | null
  redo: (workflowId: string, userId: string) => OperationEntry | null
  clear: (workflowId: string, userId: string) => void
  clearRedo: (workflowId: string, userId: string) => void
  getStackSizes: (workflowId: string, userId: string) => { undoSize: number; redoSize: number }
  setCapacity: (capacity: number) => void
  pruneInvalidEntries: (
    workflowId: string,
    userId: string,
    graph: { blocksById: Record<string, BlockState>; edgesById: Record<string, Edge> }
  ) => void
}
