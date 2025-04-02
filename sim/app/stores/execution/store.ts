import { create } from 'zustand'

interface ExecutionState {
  activeBlockIds: Set<string>
  isExecuting: boolean
}

interface ExecutionActions {
  setActiveBlocks: (blockIds: Set<string>) => void
  setIsExecuting: (isExecuting: boolean) => void
  reset: () => void
}

const initialState: ExecutionState = {
  activeBlockIds: new Set(),
  isExecuting: false,
}

export const useExecutionStore = create<ExecutionState & ExecutionActions>()((set) => ({
  ...initialState,

  setActiveBlocks: (blockIds) => set({ activeBlockIds: new Set(blockIds) }),
  setIsExecuting: (isExecuting) => set({ isExecuting }),
  reset: () => set(initialState),
}))
