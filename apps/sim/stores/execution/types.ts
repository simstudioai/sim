import type { Executor } from '@/executor'
import type { SerializableExecutionState } from '@/executor/execution/types'
import type { ExecutionContext } from '@/executor/types'

/**
 * Represents the execution result of a block in the last run
 */
export type BlockRunStatus = 'success' | 'error'

/**
 * Represents the execution result of an edge in the last run
 */
export type EdgeRunStatus = 'success' | 'error'

export interface ExecutionState {
  activeBlockIds: Set<string>
  isExecuting: boolean
  isDebugging: boolean
  pendingBlocks: string[]
  executor: Executor | null
  debugContext: ExecutionContext | null
  lastRunPath: Map<string, BlockRunStatus>
  lastRunEdges: Map<string, EdgeRunStatus>
  lastExecutionSnapshots: Map<string, SerializableExecutionState>
}

export interface ExecutionActions {
  setActiveBlocks: (blockIds: Set<string>) => void
  setIsExecuting: (isExecuting: boolean) => void
  setIsDebugging: (isDebugging: boolean) => void
  setPendingBlocks: (blockIds: string[]) => void
  setExecutor: (executor: Executor | null) => void
  setDebugContext: (context: ExecutionContext | null) => void
  setBlockRunStatus: (blockId: string, status: BlockRunStatus) => void
  setEdgeRunStatus: (edgeId: string, status: EdgeRunStatus) => void
  clearRunPath: () => void
  reset: () => void
  setLastExecutionSnapshot: (workflowId: string, snapshot: SerializableExecutionState) => void
  getLastExecutionSnapshot: (workflowId: string) => SerializableExecutionState | undefined
  clearLastExecutionSnapshot: (workflowId: string) => void
}

export const initialState: ExecutionState = {
  activeBlockIds: new Set(),
  isExecuting: false,
  isDebugging: false,
  pendingBlocks: [],
  executor: null,
  debugContext: null,
  lastRunPath: new Map(),
  lastRunEdges: new Map(),
  lastExecutionSnapshots: new Map(),
}
