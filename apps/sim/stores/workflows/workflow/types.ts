import type { Edge } from 'reactflow'
import type { OutputFieldDefinition, SubBlockType } from '@/blocks/types'
import type { DeploymentStatus } from '@/stores/workflows/registry/types'

export const SUBFLOW_TYPES = {
  LOOP: 'loop',
  PARALLEL: 'parallel',
} as const

export type SubflowType = (typeof SUBFLOW_TYPES)[keyof typeof SUBFLOW_TYPES]

export function isValidSubflowType(type: string): type is SubflowType {
  return Object.values(SUBFLOW_TYPES).includes(type as SubflowType)
}

export interface LoopConfig {
  nodes: string[]
  iterations: number
  loopType: 'for' | 'forEach' | 'while' | 'doWhile'
  forEachItems?: unknown[] | Record<string, unknown> | string
  whileCondition?: string // JS expression that evaluates to boolean (for while loops)
  doWhileCondition?: string // JS expression that evaluates to boolean (for do-while loops)
}

export interface ParallelConfig {
  nodes: string[]
  distribution?: unknown[] | Record<string, unknown> | string
  parallelType?: 'count' | 'collection'
}

export interface Subflow {
  id: string
  workflowId: string
  type: SubflowType
  config: LoopConfig | ParallelConfig
  createdAt: Date
  updatedAt: Date
}

export interface Position {
  x: number
  y: number
}

export interface BlockData {
  // Parent-child relationships for container nodes
  parentId?: string
  extent?: 'parent'

  // Container dimensions
  width?: number
  height?: number

  // Loop-specific properties
  collection?: any // The items to iterate over in a forEach loop
  count?: number // Number of iterations for numeric loops
  loopType?: 'for' | 'forEach' | 'while' | 'doWhile' // Type of loop - must match Loop interface
  whileCondition?: string // While loop condition (JS expression)
  doWhileCondition?: string // Do-While loop condition (JS expression)

  // Parallel-specific properties
  parallelType?: 'collection' | 'count' // Type of parallel execution

  // Container node type (for ReactFlow node type determination)
  type?: string

  /** Canonical swap overrides keyed by canonicalParamId */
  canonicalModes?: Record<string, 'basic' | 'advanced'>
}

export interface BlockLayoutState {
  measuredWidth?: number
  measuredHeight?: number
}

export interface BlockState {
  id: string
  type: string
  name: string
  position: Position
  subBlocks: Record<string, SubBlockState>
  outputs: Record<string, OutputFieldDefinition>
  enabled: boolean
  horizontalHandles?: boolean
  height?: number
  advancedMode?: boolean
  triggerMode?: boolean
  data?: BlockData
  layout?: BlockLayoutState
  locked?: boolean
}

export interface SubBlockState {
  id: string
  type: SubBlockType
  value: string | number | string[][] | null
}

export interface LoopBlock {
  id: string
  loopType: 'for' | 'forEach'
  count: number
  collection: string
  width: number
  height: number
  executionState: {
    isExecuting: boolean
    startTime: null | number
    endTime: null | number
  }
}

export interface ParallelBlock {
  id: string
  collection: string
  width: number
  height: number
  executionState: {
    currentExecution: number
    isExecuting: boolean
    startTime: null | number
    endTime: null | number
  }
}

export interface Loop {
  id: string
  nodes: string[]
  iterations: number
  loopType: 'for' | 'forEach' | 'while' | 'doWhile'
  forEachItems?: any[] | Record<string, any> | string // Items or expression
  whileCondition?: string // JS expression that evaluates to boolean (for while loops)
  doWhileCondition?: string // JS expression that evaluates to boolean (for do-while loops)
  enabled: boolean
  locked?: boolean
}

export interface Parallel {
  id: string
  nodes: string[]
  distribution?: any[] | Record<string, any> | string // Items or expression
  count?: number // Number of parallel executions for count-based parallel
  parallelType?: 'count' | 'collection' // Explicit parallel type to avoid inference bugs
  enabled: boolean
  locked?: boolean
}

export interface Variable {
  id: string
  name: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'plain'
  value: unknown
}

export interface DragStartPosition {
  id: string
  x: number
  y: number
  parentId?: string | null
}

export interface WorkflowState {
  blocks: Record<string, BlockState>
  edges: Edge[]
  lastSaved?: number
  loops: Record<string, Loop>
  parallels: Record<string, Parallel>
  lastUpdate?: number
  metadata?: {
    name?: string
    description?: string
    exportedAt?: string
  }
  variables?: Record<string, Variable>
  deploymentStatuses?: Record<string, DeploymentStatus>
  needsRedeployment?: boolean
  dragStartPosition?: DragStartPosition | null
}

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
  setNeedsRedeploymentFlag: (needsRedeployment: boolean) => void
  revertToDeployedState: (deployedState: WorkflowState) => void
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
}

export type WorkflowStore = WorkflowState & WorkflowActions
