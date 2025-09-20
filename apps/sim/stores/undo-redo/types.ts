export type OperationType =
  | 'add-block'
  | 'remove-block'
  | 'add-edge'
  | 'remove-edge'
  | 'add-subflow'
  | 'remove-subflow'
  | 'move-block'
  | 'move-subflow'
  | 'duplicate-block'
  | 'update-parent'

export interface BaseOperation {
  id: string
  type: OperationType
  timestamp: number
  workflowId: string
  userId: string
}

export interface AddBlockOperation extends BaseOperation {
  type: 'add-block'
  data: {
    blockId: string
  }
}

export interface RemoveBlockOperation extends BaseOperation {
  type: 'remove-block'
  data: {
    blockId: string
    blockSnapshot: any
    edgeSnapshots?: any[]
    allBlockSnapshots?: Record<string, any>
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
    edgeSnapshot: any
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
    subflowSnapshot: any
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

export interface DuplicateBlockOperation extends BaseOperation {
  type: 'duplicate-block'
  data: {
    sourceBlockId: string
    duplicatedBlockId: string
    duplicatedBlockSnapshot: any
    autoConnectEdge?: any
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
    affectedEdges?: any[] // Edges that are removed/added as part of parent change
  }
}

export type Operation =
  | AddBlockOperation
  | RemoveBlockOperation
  | AddEdgeOperation
  | RemoveEdgeOperation
  | AddSubflowOperation
  | RemoveSubflowOperation
  | MoveBlockOperation
  | MoveSubflowOperation
  | DuplicateBlockOperation
  | UpdateParentOperation

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
    graph: { blocksById: Record<string, any>; edgesById: Record<string, any> }
  ) => void
}
