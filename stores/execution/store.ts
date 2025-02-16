import { create } from 'zustand'

interface ExecutionState {
  activeBlockId: string | null
  isExecuting: boolean
}

interface ExecutionActions {
  setActiveBlock: (blockId: string | null) => void
  setIsExecuting: (isExecuting: boolean) => void
  reset: () => void
}

const initialState: ExecutionState = {
  activeBlockId: null,
  isExecuting: false,
}

export const useExecutionStore = create<ExecutionState & ExecutionActions>()((set) => ({
  ...initialState,

  setActiveBlock: (blockId) => set({ activeBlockId: blockId }),
  setIsExecuting: (isExecuting) => set({ isExecuting }),
  reset: () => set(initialState),
}))
