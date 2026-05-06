import type { Edge } from 'reactflow'
import type { OutputFieldDefinition, SubBlockType } from './blocks'

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
  whileCondition?: string
  doWhileCondition?: string
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
  parentId?: string
  extent?: 'parent'
  width?: number
  height?: number
  collection?: any
  count?: number
  loopType?: 'for' | 'forEach' | 'while' | 'doWhile'
  whileCondition?: string
  doWhileCondition?: string
  parallelType?: 'collection' | 'count'
  type?: string
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
  forEachItems?: any[] | Record<string, any> | string
  whileCondition?: string
  doWhileCondition?: string
  enabled: boolean
  locked?: boolean
}

export interface Parallel {
  id: string
  nodes: string[]
  distribution?: any[] | Record<string, any> | string
  count?: number
  parallelType?: 'count' | 'collection'
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
  currentWorkflowId?: string | null
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
  dragStartPosition?: DragStartPosition | null
}
