import { create } from 'zustand'
import {
  type ExecutionActions,
  type ExecutionState,
  initialState,
  type PanToBlockCallback,
  type SetPanToBlockCallback,
} from '@/stores/execution/types'
import { useGeneralStore } from '@/stores/settings/general/store'

// Global callback for panning to active blocks
let panToBlockCallback: PanToBlockCallback | null = null

export const setPanToBlockCallback: SetPanToBlockCallback = (callback) => {
  panToBlockCallback = callback
}

export const useExecutionStore = create<ExecutionState & ExecutionActions>()((set, get) => ({
  ...initialState,

  setActiveBlocks: (blockIds) => {
    set({ activeBlockIds: new Set(blockIds) })

    // Pan to the first active block if auto-pan is enabled and we have a callback and blocks are active
    const { autoPanDisabled } = get()
    const isAutoPanEnabled = useGeneralStore.getState().isAutoPanEnabled

    if (panToBlockCallback && !autoPanDisabled && isAutoPanEnabled && blockIds.size > 0) {
      const firstActiveBlockId = Array.from(blockIds)[0]
      panToBlockCallback(firstActiveBlockId)
    }
  },

  setPendingBlocks: (pendingBlocks) => {
    set({ pendingBlocks })

    // Pan to the first pending block if auto-pan is enabled, we have a callback, blocks are pending, and we're in debug mode
    const { isDebugging, autoPanDisabled } = get()
    const isAutoPanEnabled = useGeneralStore.getState().isAutoPanEnabled

    if (
      panToBlockCallback &&
      !autoPanDisabled &&
      isAutoPanEnabled &&
      pendingBlocks.length > 0 &&
      isDebugging
    ) {
      const firstPendingBlockId = pendingBlocks[0]
      panToBlockCallback(firstPendingBlockId)
    }
  },

  setIsExecuting: (isExecuting) => {
    set({ isExecuting })
    // Reset auto-pan disabled state when starting execution
    if (isExecuting) {
      set({ autoPanDisabled: false })
      // Clear run path when starting a new execution
      set({ lastRunPath: new Map(), lastRunEdges: new Map() })
    }
  },
  setIsDebugging: (isDebugging) => set({ isDebugging }),
  setExecutor: (executor) => set({ executor }),
  setDebugContext: (debugContext) => set({ debugContext }),
  setAutoPanDisabled: (disabled) => set({ autoPanDisabled: disabled }),
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
}))
