import type { BlockOutput, ParamType } from '@/blocks/types'
import type { Position } from '@/stores/workflows/workflow/types'

export interface SerializedWorkflow {
  version: string
  blocks: SerializedBlock[]
  connections: SerializedConnection[]
  loops: Record<string, SerializedLoop>
  parallels?: Record<string, SerializedParallel>
}

export interface SerializedConnection {
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
  condition?: {
    type: 'if' | 'else' | 'else if'
    expression?: string // JavaScript expression to evaluate
  }
}

export interface SerializedBlock {
  id: string
  position: Position
  config: {
    tool: string
    params: Record<string, any>
  }
  inputs: Record<string, ParamType>
  outputs: Record<string, BlockOutput>
  metadata?: {
    id: string
    name?: string
    description?: string
    category?: string
    icon?: string
    color?: string
  }
  enabled: boolean
}

export interface SerializedLoop {
  id: string
  nodes: string[]
  iterations: number
  loopType?: 'for' | 'forEach' | 'while'
  forEachItems?: any[] | Record<string, any> | string // Items to iterate over or expression to evaluate
}

export interface SerializedParallel {
  id: string
  nodes: string[]
  distribution?: any[] | Record<string, any> | string // Items to distribute or expression to evaluate
  count?: number // Number of parallel executions for count-based parallel
  parallelType?: 'count' | 'collection' // Explicit parallel type to avoid inference bugs
}
