import type { BlockRetryConfig } from '@sim/workflow-types/workflow'
import type { OutputFieldDefinition, ParamType } from '@/blocks/types'
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
    params: Record<string, unknown>
  }
  inputs: Record<string, ParamType>
  outputs: Record<string, OutputFieldDefinition>
  metadata?: {
    id: string
    name?: string
    description?: string
    category?: string
    icon?: string
    color?: string
  }
  enabled: boolean
  /** Canonical mode overrides from block.data (used by agent handler for tool param resolution) */
  canonicalModes?: Record<string, 'basic' | 'advanced'>
  /** Server-only lifecycle input ids omitted from execution-log projections. */
  privateInputIds?: string[]
  /** Opt-in retry for failed tries; absent means the block runs exactly once. */
  retry?: BlockRetryConfig
}

export interface SerializedLoop {
  id: string
  nodes: string[]
  iterations: number
  loopType?: 'for' | 'forEach' | 'while' | 'doWhile'
  forEachItems?: any[] | Record<string, any> | string // Items to iterate over or expression to evaluate
  whileCondition?: string // JS expression that evaluates to boolean (for while loops)
  doWhileCondition?: string // JS expression that evaluates to boolean (for do-while loops)
}

export interface SerializedParallel {
  id: string
  nodes: string[]
  distribution?: any[] | Record<string, any> | string // Items to distribute or expression to evaluate
  count?: number // Number of parallel executions for count-based parallel
  parallelType?: 'count' | 'collection' // Explicit parallel type to avoid inference bugs
  batchSize?: number // Maximum number of branches to run concurrently per batch
}
