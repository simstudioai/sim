import type { BlockState, NormalizedBlockOutput } from '@/executor/types'
import type { SubflowType } from '@/stores/workflows/workflow/types'

export interface ContextExtensions {
  workspaceId?: string
  executionId?: string
  userId?: string
  stream?: boolean
  selectedOutputs?: string[]
  edges?: Array<{ source: string; target: string }>
  isDeployedContext?: boolean
  isChildExecution?: boolean
  resumeFromSnapshot?: boolean
  resumePendingQueue?: string[]
  remainingEdges?: Array<{
    source: string
    target: string
    sourceHandle?: string
    targetHandle?: string
  }>
  dagIncomingEdges?: Record<string, string[]>
  snapshotState?: import('@/executor/execution/snapshot').SerializableExecutionState
  onStream?: (streamingExecution: unknown) => Promise<void>
  onBlockStart?: (
    blockId: string,
    blockName: string,
    blockType: string,
    iterationContext?: {
      iterationCurrent: number
      iterationTotal: number
      iterationType: SubflowType
    }
  ) => Promise<void>
  onBlockComplete?: (
    blockId: string,
    blockName: string,
    blockType: string,
    output: { input?: any; output: NormalizedBlockOutput; executionTime: number },
    iterationContext?: {
      iterationCurrent: number
      iterationTotal: number
      iterationType: SubflowType
    }
  ) => Promise<void>
}

export interface WorkflowInput {
  [key: string]: unknown
}

export interface BlockStateReader {
  getBlockOutput(blockId: string, currentNodeId?: string): NormalizedBlockOutput | undefined
  hasExecuted(blockId: string): boolean
}

export interface BlockStateWriter {
  setBlockOutput(blockId: string, output: NormalizedBlockOutput, executionTime?: number): void
  setBlockState(blockId: string, state: BlockState): void
  deleteBlockState(blockId: string): void
  unmarkExecuted(blockId: string): void
}

export type BlockStateController = BlockStateReader & BlockStateWriter
