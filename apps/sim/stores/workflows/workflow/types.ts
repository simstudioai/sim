import type {
  BlockData,
  BlockLayoutState,
  BlockState,
  DragStartPosition,
  Loop,
  LoopBlock,
  LoopConfig,
  Parallel,
  ParallelBlock,
  ParallelConfig,
  Position,
  SubBlockState,
  Subflow,
  SubflowType,
  Variable,
  WorkflowState,
} from '@sim/workflow-types/workflow'
import type { Edge } from 'reactflow'

export type {
  BlockData,
  BlockLayoutState,
  BlockState,
  DragStartPosition,
  Loop,
  LoopBlock,
  LoopConfig,
  Parallel,
  ParallelBlock,
  ParallelConfig,
  Position,
  SubBlockState,
  Subflow,
  SubflowType,
  Variable,
  WorkflowState,
}
export { isValidSubflowType, SUBFLOW_TYPES } from '@sim/workflow-types/workflow'

export interface WorkflowActions {
  updateNodeDimensions: (id: string, dimensions: { width: number; height: number }) => void
  batchUpdateBlocksWithParent: (
    updates: Array<{
      id: string
      position: { x: number; y: number }
      parentId?: string
    }>
  ) => void
  batchUpdatePositions: (updates: Array<{ id: string; position: Position }>) => void
  batchAddBlocks: (
    blocks: BlockState[],
    edges?: Edge[],
    subBlockValues?: Record<string, Record<string, unknown>>,
    options?: { skipEdgeValidation?: boolean }
  ) => void
  batchRemoveBlocks: (ids: string[]) => void
  batchToggleEnabled: (ids: string[]) => void
  batchToggleHandles: (ids: string[]) => void
  batchAddEdges: (edges: Edge[], options?: { skipValidation?: boolean }) => void
  batchRemoveEdges: (ids: string[]) => void
  clear: () => Partial<WorkflowState>
  updateLastSaved: () => void
  setBlockEnabled: (id: string, enabled: boolean) => void
  duplicateBlock: (id: string) => void
  setBlockHandles: (id: string, horizontalHandles: boolean) => void
  updateBlockName: (
    id: string,
    name: string
  ) => {
    success: boolean
    changedSubblocks: Array<{ blockId: string; subBlockId: string; newValue: any }>
  }
  setBlockAdvancedMode: (id: string, advancedMode: boolean) => void
  setBlockCanonicalMode: (id: string, canonicalId: string, mode: 'basic' | 'advanced') => void
  syncDynamicHandleSubblockValue: (blockId: string, subblockId: string, value: unknown) => void
  setBlockTriggerMode: (id: string, triggerMode: boolean) => void
  updateBlockLayoutMetrics: (id: string, dimensions: { width: number; height: number }) => void
  triggerUpdate: () => void
  updateLoopCount: (loopId: string, count: number) => void
  updateLoopType: (loopId: string, loopType: 'for' | 'forEach' | 'while' | 'doWhile') => void
  updateLoopCollection: (loopId: string, collection: string) => void
  setLoopForEachItems: (loopId: string, items: any) => void
  setLoopWhileCondition: (loopId: string, condition: string) => void
  setLoopDoWhileCondition: (loopId: string, condition: string) => void
  updateParallelCount: (parallelId: string, count: number) => void
  updateParallelCollection: (parallelId: string, collection: string) => void
  updateParallelType: (parallelId: string, parallelType: 'count' | 'collection') => void
  generateLoopBlocks: () => Record<string, Loop>
  generateParallelBlocks: () => Record<string, Parallel>
  toggleBlockAdvancedMode: (id: string) => void
  setDragStartPosition: (position: DragStartPosition | null) => void
  getDragStartPosition: () => DragStartPosition | null
  getWorkflowState: () => WorkflowState
  replaceWorkflowState: (
    workflowState: WorkflowState,
    options?: { updateLastSaved?: boolean }
  ) => void
  setBlockLocked: (id: string, locked: boolean) => void
  batchToggleLocked: (ids: string[]) => void
  setCurrentWorkflowId: (workflowId: string | null) => void
}

export type WorkflowStore = WorkflowState & WorkflowActions
