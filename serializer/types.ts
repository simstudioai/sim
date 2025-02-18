import { Position } from '@/stores/workflow/types'
import { BlockOutput, ParamType } from '@/blocks/types'

export interface SerializedWorkflow {
  version: string
  blocks: SerializedBlock[]
  connections: SerializedConnection[]
  loops: Record<string, SerializedLoop>
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
  maxIterations: number
}
