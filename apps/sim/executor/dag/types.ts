import type { NormalizedBlockOutput } from '@/executor/types'

export interface DAGEdge {
  target: string
  sourceHandle?: string
  targetHandle?: string
  isActive?: boolean
}

export interface NodeMetadata {
  isParallelBranch?: boolean
  branchIndex?: number
  branchTotal?: number
  distributionItem?: unknown
  isLoopNode?: boolean
  loopId?: string
  isSentinel?: boolean
  sentinelType?: 'start' | 'end'
}

export interface ContextExtensions {
  stream?: boolean
  selectedOutputs?: string[]
  edges?: Array<{ source: string; target: string }>
  isDeployedContext?: boolean
  onStream?: (streamingExecution: unknown) => Promise<string>
  onBlockStart?: (blockId: string, blockName: string, blockType: string) => Promise<void>
  onBlockComplete?: (
    blockId: string,
    blockName: string,
    blockType: string,
    output: { output: NormalizedBlockOutput; executionTime: number }
  ) => Promise<void>
}

export interface WorkflowInput {
  [key: string]: unknown
}

