import type { Edge } from 'reactflow'
import type { BlockLog, BlockState, NormalizedBlockOutput } from '@/executor/types'
import type { RunFromBlockContext } from '@/executor/utils/run-from-block'
import type { SubflowType } from '@/stores/workflows/workflow/types'

export interface ExecutionMetadata {
  requestId: string
  executionId: string
  workflowId: string
  workspaceId: string
  userId: string
  sessionUserId?: string
  workflowUserId?: string
  triggerType: string
  triggerBlockId?: string
  useDraftState: boolean
  startTime: string
  isClientSession?: boolean
  pendingBlocks?: string[]
  resumeFromSnapshot?: boolean
  credentialAccountUserId?: string
  workflowStateOverride?: {
    blocks: Record<string, any>
    edges: Edge[]
    loops?: Record<string, any>
    parallels?: Record<string, any>
    deploymentVersionId?: string
  }
}

export interface SerializableExecutionState {
  blockStates: Record<string, BlockState>
  executedBlocks: string[]
  blockLogs: BlockLog[]
  decisions: {
    router: Record<string, string>
    condition: Record<string, string>
  }
  completedLoops: string[]
  loopExecutions?: Record<string, any>
  parallelExecutions?: Record<string, any>
  parallelBlockMapping?: Record<string, any>
  activeExecutionPath: string[]
  pendingQueue?: string[]
  remainingEdges?: Edge[]
  dagIncomingEdges?: Record<string, string[]>
  completedPauseContexts?: string[]
}

export interface IterationContext {
  iterationCurrent: number
  iterationTotal: number
  iterationType: SubflowType
}

export interface ExecutionCallbacks {
  onStream?: (streamingExec: any) => Promise<void>
  onBlockStart?: (
    blockId: string,
    blockName: string,
    blockType: string,
    executionOrder: number,
    iterationContext?: IterationContext
  ) => Promise<void>
  onBlockComplete?: (
    blockId: string,
    blockName: string,
    blockType: string,
    output: any,
    iterationContext?: IterationContext
  ) => Promise<void>
}

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
  snapshotState?: SerializableExecutionState
  metadata?: ExecutionMetadata
  /**
   * AbortSignal for cancellation support.
   * When aborted, the execution should stop gracefully.
   */
  abortSignal?: AbortSignal
  includeFileBase64?: boolean
  base64MaxBytes?: number
  onStream?: (streamingExecution: unknown) => Promise<void>
  onBlockStart?: (
    blockId: string,
    blockName: string,
    blockType: string,
    executionOrder: number,
    iterationContext?: IterationContext
  ) => Promise<void>
  onBlockComplete?: (
    blockId: string,
    blockName: string,
    blockType: string,
    output: {
      input?: any
      output: NormalizedBlockOutput
      executionTime: number
      startedAt: string
      executionOrder: number
      endedAt: string
    },
    iterationContext?: IterationContext
  ) => Promise<void>

  /**
   * Run-from-block configuration. When provided, executor runs in partial
   * execution mode starting from the specified block.
   */
  runFromBlockContext?: RunFromBlockContext

  /**
   * Stop execution after this block completes. Used for "run until block" feature.
   */
  stopAfterBlockId?: string
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
