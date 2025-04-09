import { create } from 'zustand'
import { ExecutionActions, ExecutionState, initialState } from './types'

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
