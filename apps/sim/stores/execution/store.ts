import { create } from 'zustand'
import { type ExecutionActions, type ExecutionState, initialState } from './types'

export const useExecutionStore = create<ExecutionState & ExecutionActions>()((set, get) => ({
  ...initialState,

  setActiveBlocks: (blockIds) => {
    set({ activeBlockIds: new Set(blockIds) })
  },

  setPendingBlocks: (pendingBlocks) => {
    set({ pendingBlocks })
  },

  setIsExecuting: (isExecuting) => {
    set({ isExecuting })
    if (isExecuting) {
      set({ lastRunPath: new Map(), lastRunEdges: new Map() })
    }
  },
  setIsDebugging: (isDebugging) => set({ isDebugging }),
  setExecutor: (executor) => set({ executor }),
  setDebugContext: (debugContext) => set({ debugContext }),
  setBlockRunStatus: (blockId, status) => {
    const { lastRunPath } = get()
    const newRunPath = new Map(lastRunPath)
    newRunPath.set(blockId, status)
    set({ lastRunPath: newRunPath })
  },
  setEdgeRunStatus: (edgeId, status) => {
    const { lastRunEdges } = get()
    const newRunEdges = new Map(lastRunEdges)
    newRunEdges.set(edgeId, status)
    set({ lastRunEdges: newRunEdges })
  },
  clearRunPath: () => set({ lastRunPath: new Map(), lastRunEdges: new Map() }),
  reset: () => set(initialState),

  setLastExecutionSnapshot: (workflowId, snapshot) => {
    const { lastExecutionSnapshots } = get()
    const newSnapshots = new Map(lastExecutionSnapshots)
    newSnapshots.set(workflowId, snapshot)
    set({ lastExecutionSnapshots: newSnapshots })
  },

  getLastExecutionSnapshot: (workflowId) => {
    const { lastExecutionSnapshots } = get()
    return lastExecutionSnapshots.get(workflowId)
  },

  clearLastExecutionSnapshot: (workflowId) => {
    const { lastExecutionSnapshots } = get()
    const newSnapshots = new Map(lastExecutionSnapshots)
    newSnapshots.delete(workflowId)
    set({ lastExecutionSnapshots: newSnapshots })
  },
}))
