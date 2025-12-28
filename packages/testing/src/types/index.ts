/**
 * Core types for the testing package.
 *
 * These are intentionally loose/permissive types that accept any shape of data
 * from the app. The testing package should not try to mirror app types exactly -
 * that creates maintenance burden and type drift issues.
 *
 * Tests themselves provide type safety through their actual usage of app types.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface Position {
  x: number
  y: number
}

export interface BlockData {
  parentId?: string
  extent?: string
  width?: number
  height?: number
  count?: number
  loopType?: string
  parallelType?: string
  collection?: any
  whileCondition?: string
  doWhileCondition?: string
  type?: string
  [key: string]: any
}

export interface SubBlockState {
  id: string
  type: string
  value: any
}

export type BlockOutput = any

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
  layout?: Record<string, any>
  [key: string]: any
}

export interface Edge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  type?: string
  data?: Record<string, any>
  [key: string]: any
}

export interface Loop {
  id: string
  nodes: string[]
  iterations: number
  loopType: string
  forEachItems?: any
  whileCondition?: string
  doWhileCondition?: string
  [key: string]: any
}

export interface Parallel {
  id: string
  nodes: string[]
  distribution?: any
  count?: number
  parallelType?: string
  [key: string]: any
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
  variables?: any[]
  [key: string]: any
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
  [key: string]: any
}

export interface User {
  id: string
  email: string
  name?: string
  image?: string
  [key: string]: any
}

export interface Workspace {
  id: string
  name: string
  ownerId: string
  createdAt: Date
  updatedAt: Date
  [key: string]: any
}

export interface Workflow {
  id: string
  name: string
  workspaceId: string
  state: WorkflowState
  createdAt: Date
  updatedAt: Date
  isDeployed?: boolean
  [key: string]: any
}
