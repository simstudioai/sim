import type { Edge } from 'reactflow'
import type { UNDO_REDO_OPERATIONS, UndoRedoOperation } from '@/socket/constants'
import type { BlockState } from '@/stores/workflows/workflow/types'

export type OperationType = UndoRedoOperation

export interface BaseOperation {
  id: string
  type: OperationType
  timestamp: number
  workflowId: string
  userId: string
}

export interface BatchAddBlocksOperation extends BaseOperation {
  type: typeof UNDO_REDO_OPERATIONS.BATCH_ADD_BLOCKS
  data: {
    blockSnapshots: BlockState[]
    edgeSnapshots: Edge[]
    subBlockValues: Record<string, Record<string, unknown>>
  }
}

export interface BatchRemoveBlocksOperation extends BaseOperation {
  type: typeof UNDO_REDO_OPERATIONS.BATCH_REMOVE_BLOCKS
  data: {
    blockSnapshots: BlockState[]
    edgeSnapshots: Edge[]
    subBlockValues: Record<string, Record<string, unknown>>
  }
}

export interface BatchAddEdgesOperation extends BaseOperation {
  type: typeof UNDO_REDO_OPERATIONS.BATCH_ADD_EDGES
  data: {
    edgeSnapshots: Edge[]
  }
}

export interface BatchRemoveEdgesOperation extends BaseOperation {
  type: typeof UNDO_REDO_OPERATIONS.BATCH_REMOVE_EDGES
  data: {
    edgeSnapshots: Edge[]
  }
}

export interface BatchMoveBlocksOperation extends BaseOperation {
  type: typeof UNDO_REDO_OPERATIONS.BATCH_MOVE_BLOCKS
  data: {
    moves: Array<{
      blockId: string
      before: { x: number; y: number; parentId?: string }
      after: { x: number; y: number; parentId?: string }
    }>
  }
}

export interface UpdateParentOperation extends BaseOperation {
  type: typeof UNDO_REDO_OPERATIONS.UPDATE_PARENT
  data: {
    blockId: string
    oldParentId?: string
    newParentId?: string
    oldPosition: { x: number; y: number }
    newPosition: { x: number; y: number }
    affectedEdges?: Edge[]
  }
}

export interface BatchUpdateParentOperation extends BaseOperation {
  type: typeof UNDO_REDO_OPERATIONS.BATCH_UPDATE_PARENT
  data: {
    updates: Array<{
      blockId: string
      oldParentId?: string
      newParentId?: string
      oldPosition: { x: number; y: number }
      newPosition: { x: number; y: number }
      affectedEdges?: Edge[]
    }>
  }
}

export interface BatchToggleEnabledOperation extends BaseOperation {
  type: typeof UNDO_REDO_OPERATIONS.BATCH_TOGGLE_ENABLED
  data: {
    blockIds: string[]
    previousStates: Record<string, boolean>
  }
}

export interface BatchToggleHandlesOperation extends BaseOperation {
  type: typeof UNDO_REDO_OPERATIONS.BATCH_TOGGLE_HANDLES
  data: {
    blockIds: string[]
    previousStates: Record<string, boolean>
  }
}

export interface BatchToggleLockedOperation extends BaseOperation {
  type: typeof UNDO_REDO_OPERATIONS.BATCH_TOGGLE_LOCKED
  data: {
    blockIds: string[]
    previousStates: Record<string, boolean>
  }
}

export interface ApplyDiffOperation extends BaseOperation {
  type: typeof UNDO_REDO_OPERATIONS.APPLY_DIFF
  data: {
    baselineSnapshot: any // WorkflowState snapshot before diff
    proposedState: any // WorkflowState with diff applied
    diffAnalysis: any // DiffAnalysis for re-applying markers
  }
}

export interface AcceptDiffOperation extends BaseOperation {
  type: typeof UNDO_REDO_OPERATIONS.ACCEPT_DIFF
  data: {
    beforeAccept: any // WorkflowState with diff markers
    afterAccept: any // WorkflowState without diff markers
    diffAnalysis: any // DiffAnalysis to restore markers on undo
    baselineSnapshot: any // Baseline workflow state
  }
}

export interface RejectDiffOperation extends BaseOperation {
  type: typeof UNDO_REDO_OPERATIONS.REJECT_DIFF
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
  | BatchAddEdgesOperation
  | BatchRemoveEdgesOperation
  | BatchMoveBlocksOperation
  | UpdateParentOperation
  | BatchUpdateParentOperation
  | BatchToggleEnabledOperation
  | BatchToggleHandlesOperation
  | BatchToggleLockedOperation
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
