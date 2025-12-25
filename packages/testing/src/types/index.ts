/**
 * Core types for the testing package.
 * These are simplified versions of the actual types used in apps/sim,
 * designed for test scenarios without requiring all dependencies.
 */

export interface Position {
  x: number
  y: number
}

export interface BlockData {
  parentId?: string
  extent?: 'parent'
  width?: number
  height?: number
  count?: number
  loopType?: 'for' | 'forEach' | 'while' | 'doWhile'
  parallelType?: 'count' | 'collection'
  collection?: any
  whileCondition?: string
  doWhileCondition?: string
  type?: string
}

/**
 * SubBlockType union for testing.
 * Matches the SubBlockType values from the app (apps/sim/blocks/types.ts).
 */
export type SubBlockType =
  | 'short-input'
  | 'long-input'
  | 'dropdown'
  | 'combobox'
  | 'slider'
  | 'table'
  | 'code'
  | 'switch'
  | 'tool-input'
  | 'checkbox-list'
  | 'grouped-checkbox-list'
  | 'condition-input'
  | 'eval-input'
  | 'time-input'
  | 'oauth-input'
  | 'webhook-config'
  | 'schedule-info'
  | 'file-selector'
  | 'project-selector'
  | 'channel-selector'
  | 'user-selector'
  | 'folder-selector'
  | 'knowledge-base-selector'
  | 'knowledge-tag-filters'
  | 'document-selector'
  | 'document-tag-entry'
  | 'mcp-server-selector'
  | 'mcp-tool-selector'
  | 'mcp-dynamic-args'
  | 'input-format'

export interface SubBlockState {
  id: string
  type: SubBlockType
  value: string | number | string[][] | null
}

/**
 * Primitive value types for block outputs.
 */
export type PrimitiveValueType = 'string' | 'number' | 'boolean'

/**
 * BlockOutput type matching the app's structure.
 * Can be a primitive type or an object with string keys.
 */
export type BlockOutput =
  | PrimitiveValueType
  | { [key: string]: PrimitiveValueType | Record<string, any> }

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
  layout?: {
    measuredWidth?: number
    measuredHeight?: number
  }
}

export interface Edge {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
  type?: string
  data?: Record<string, any>
}

export interface Loop {
  id: string
  nodes: string[]
  iterations: number
  loopType: 'for' | 'forEach' | 'while' | 'doWhile'
  forEachItems?: any[] | Record<string, any> | string
  whileCondition?: string
  doWhileCondition?: string
}

export interface Parallel {
  id: string
  nodes: string[]
  distribution?: any[] | Record<string, any> | string
  count?: number
  parallelType?: 'count' | 'collection'
}

export interface WorkflowState {
  blocks: Record<string, BlockState>
  edges: Edge[]
  loops: Record<string, Loop>
  parallels: Record<string, Parallel>
  lastSaved?: number
  lastUpdate?: number
  isDeployed?: boolean
  deployedAt?: Date
  needsRedeployment?: boolean
  variables?: Array<{
    id: string
    name: string
    type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'plain'
    value: any
  }>
}

export interface ExecutionContext {
  workflowId: string
  executionId?: string
  blockStates: Map<string, any>
  executedBlocks: Set<string>
  blockLogs: any[]
  metadata: {
    duration: number
    startTime?: string
    endTime?: string
  }
  environmentVariables: Record<string, string>
  workflowVariables?: Record<string, any>
  decisions: {
    router: Map<string, any>
    condition: Map<string, any>
  }
  loopExecutions: Map<string, any>
  completedLoops: Set<string>
  activeExecutionPath: Set<string>
  abortSignal?: AbortSignal
}

export interface User {
  id: string
  email: string
  name?: string
  image?: string
}

export interface Workspace {
  id: string
  name: string
  ownerId: string
  createdAt: Date
  updatedAt: Date
}

export interface Workflow {
  id: string
  name: string
  workspaceId: string
  state: WorkflowState
  createdAt: Date
  updatedAt: Date
  isDeployed?: boolean
}
