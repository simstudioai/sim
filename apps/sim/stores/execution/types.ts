import type { Executor } from '@/executor'
import type { ExecutionContext } from '@/executor/types'

export interface ExecutionState {
  activeBlockIds: Set<string>
  isExecuting: boolean
  isDebugging: boolean
  pendingBlocks: string[]
  executor: Executor | null
  debugContext: ExecutionContext | null
  autoPanDisabled: boolean
  panelFocusedBlockId?: string | null
  executingBlockIds: Set<string>
  breakpointId: string | null
}

export interface ExecutionActions {
  setActiveBlocks: (blockIds: Set<string>) => void
  setIsExecuting: (isExecuting: boolean) => void
  setIsDebugging: (isDebugging: boolean) => void
  setPendingBlocks: (blockIds: string[]) => void
  setExecutor: (executor: Executor | null) => void
  setDebugContext: (context: ExecutionContext | null) => void
  setAutoPanDisabled: (disabled: boolean) => void
  setPanelFocusedBlockId: (id: string | null) => void
  setExecutingBlockIds: (ids: Set<string>) => void
  setBreakpointId: (id: string | null) => void
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
  panelFocusedBlockId: null,
  executingBlockIds: new Set(),
  breakpointId: null,
}

// Types for panning functionality
export type PanToBlockCallback = (blockId: string) => void
export type SetPanToBlockCallback = (callback: PanToBlockCallback | null) => void
