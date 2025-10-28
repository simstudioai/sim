import type { Edge } from 'reactflow'
import type { BlockOutput, SubBlockType } from '@/blocks/types'
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
  forEachItems?: any[] | Record<string, any> | string
  whileCondition?: string // JS expression that evaluates to boolean (for while loops)
  doWhileCondition?: string // JS expression that evaluates to boolean (for do-while loops)
}

export interface ParallelConfig {
  nodes: string[]
  distribution?: any[] | Record<string, any> | string
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
  outputs: Record<string, BlockOutput>
  enabled: boolean
  horizontalHandles?: boolean
  height?: number
  advancedMode?: boolean
  triggerMode?: boolean
  data?: BlockData
  layout?: BlockLayoutState
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
    currentIteration: number
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
}

export interface Parallel {
  id: string
  nodes: string[]
  distribution?: any[] | Record<string, any> | string // Items or expression
  count?: number // Number of parallel executions for count-based parallel
  parallelType?: 'count' | 'collection' // Explicit parallel type to avoid inference bugs
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
  variables?: Array<{
    id: string
    name: string
    type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'plain'
    value: any
  }>
  isDeployed?: boolean
  deployedAt?: Date
  deploymentStatuses?: Record<string, DeploymentStatus>
  needsRedeployment?: boolean
  dragStartPosition?: DragStartPosition | null
}

export interface WorkflowActions {
  addBlock: (
    id: string,
    type: string,
    name: string,
    position: Position,
    data?: Record<string, any>,
    parentId?: string,
    extent?: 'parent',
    blockProperties?: {
      enabled?: boolean
      horizontalHandles?: boolean
      advancedMode?: boolean
      triggerMode?: boolean
      height?: number
    }
  ) => void
  updateBlockPosition: (id: string, position: Position) => void
  updateNodeDimensions: (id: string, dimensions: { width: number; height: number }) => void
  updateParentId: (id: string, parentId: string, extent: 'parent') => void
  removeBlock: (id: string) => void
  addEdge: (edge: Edge) => void
  removeEdge: (edgeId: string) => void
  clear: () => Partial<WorkflowState>
  updateLastSaved: () => void
  toggleBlockEnabled: (id: string) => void
  duplicateBlock: (id: string) => void
  toggleBlockHandles: (id: string) => void
  updateBlockName: (id: string, name: string) => boolean
  setBlockAdvancedMode: (id: string, advancedMode: boolean) => void
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
  toggleBlockTriggerMode: (id: string) => void
  setDragStartPosition: (position: DragStartPosition | null) => void
  getDragStartPosition: () => DragStartPosition | null
  getWorkflowState: () => WorkflowState
}

export type WorkflowStore = WorkflowState & WorkflowActions
