/**
 * Core types for the Sim Studio SDK
 */

// API Configuration
export interface SimStudioConfig {
  apiKey?: string
  baseUrl?: string
  timeout?: number
}

// Workflow definition types
export interface Workflow {
  id?: string
  name: string
  description?: string
  blocks: Block[]
  connections: Connection[]
  loops?: Record<string, Loop>
  metadata?: Record<string, any>
}

export interface Block {
  id: string
  type: BlockType
  data: BlockData
  position?: Position
  enabled?: boolean
  metadata?: {
    name?: string
    description?: string
    id?: string
    [key: string]: any
  }
}

// Core block types
export type CoreBlockType = 
  | 'starter'
  | 'agent'
  | 'function'
  | 'condition'
  | 'router'
  | 'api'
  | 'evaluator'
  | 'generic'

// Custom block types can be any string
export type BlockType = CoreBlockType | string

export interface BlockData {
  [key: string]: any
}

export interface Connection {
  id?: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}

export interface Loop {
  nodes: string[]
  iterations: number
  iterationVariable?: string
}

export interface Position {
  x: number
  y: number
}

// Execution result types
export interface ExecutionResult {
  success: boolean
  output: any
  error?: string
  logs?: ExecutionLog[]
  metadata?: {
    startTime?: string
    endTime?: string
    duration?: number
  }
}

export interface ExecutionLog {
  blockId: string
  blockName?: string
  blockType?: string
  startedAt: string
  endedAt: string
  durationMs: number
  success: boolean
  output?: any
  error?: string
}

// Deployment types
export interface DeploymentOptions {
  isPublic?: boolean
  authentication?: 'none' | 'api_key' | 'oauth'
  rateLimit?: number
}

export interface DeploymentResult {
  id: string
  url: string
  status: 'active' | 'inactive'
  createdAt: string
}

// Schedule types
export interface ScheduleOptions {
  cron: string
  timezone?: string
  input?: Record<string, any>
  enabled?: boolean
}

export interface ScheduleResult {
  id: string
  workflowId: string
  cron: string
  nextRunAt: string
  status: 'active' | 'inactive'
} 