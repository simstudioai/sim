import type { Executor } from '@/executor'
import type { ExecutionContext } from '@/executor/types'

/**
 * Represents the execution result of a block in the last run
 */
export type BlockRunStatus = 'success' | 'error'

export interface ExecutionState {
  activeBlockIds: Set<string>
  isExecuting: boolean
  isDebugging: boolean
  pendingBlocks: string[]
  executor: Executor | null
  debugContext: ExecutionContext | null
  autoPanDisabled: boolean
  /**
   * Tracks blocks from the last execution run and their success/error status.
   * Cleared when a new run starts. Used to show run path indicators (green/red rings).
   */
  lastRunPath: Map<string, BlockRunStatus>
}

export interface ExecutionActions {
  setActiveBlocks: (blockIds: Set<string>) => void
  setIsExecuting: (isExecuting: boolean) => void
  setIsDebugging: (isDebugging: boolean) => void
  setPendingBlocks: (blockIds: string[]) => void
  setExecutor: (executor: Executor | null) => void
  setDebugContext: (context: ExecutionContext | null) => void
  setAutoPanDisabled: (disabled: boolean) => void
  setBlockRunStatus: (blockId: string, status: BlockRunStatus) => void
  clearRunPath: () => void
  reset: () => void
}

export const initialState: ExecutionState = {
  activeBlockIds: new Set(),
  isExecuting: false,
  isDebugging: false,
  pendingBlocks: [],
  executor: null,
  debugContext: null,
  autoPanDisabled: false,
  lastRunPath: new Map(),
}

// Types for panning functionality
export type PanToBlockCallback = (blockId: string) => void
export type SetPanToBlockCallback = (callback: PanToBlockCallback | null) => void
