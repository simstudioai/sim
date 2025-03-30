import { create } from 'zustand'
import { Executor } from '@/executor'
import { ExecutionContext } from '@/executor/types'

interface ExecutionState {
  activeBlockIds: Set<string>
  isExecuting: boolean
  isDebugging: boolean
  pendingBlocks: string[]
  executor: Executor | null
  debugContext: ExecutionContext | null
}

interface ExecutionActions {
  setActiveBlocks: (blockIds: Set<string>) => void
  setIsExecuting: (isExecuting: boolean) => void
  setIsDebugging: (isDebugging: boolean) => void
  setPendingBlocks: (blockIds: string[]) => void
  setExecutor: (executor: Executor | null) => void
  setDebugContext: (context: ExecutionContext | null) => void
  reset: () => void
}

const initialState: ExecutionState = {
  activeBlockIds: new Set(),
  isExecuting: false,
  isDebugging: false,
  pendingBlocks: [],
  executor: null,
  debugContext: null,
}

export const useExecutionStore = create<ExecutionState & ExecutionActions>()((set) => ({
  ...initialState,

  setActiveBlocks: (blockIds) => set({ activeBlockIds: new Set(blockIds) }),
  setIsExecuting: (isExecuting) => set({ isExecuting }),
  setIsDebugging: (isDebugging) => set({ isDebugging }),
  setPendingBlocks: (pendingBlocks) => set({ pendingBlocks }),
  setExecutor: (executor) => set({ executor }),
  setDebugContext: (debugContext) => set({ debugContext }),
  reset: () => set(initialState),
}))
