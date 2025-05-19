import { StateCreator } from 'zustand'
import { saveSubblockValues, saveWorkflowState } from './persistence'
import { useWorkflowRegistry } from './registry/store'
import { useSubBlockStore } from './subblock/store'
import { WorkflowState, WorkflowStore } from './workflow/types'

// Types
interface HistoryEntry {
  state: WorkflowState
  timestamp: number
  action: string
  subblockValues: Record<string, Record<string, any>>
}

interface WorkflowHistory {
  past: HistoryEntry[]
  present: HistoryEntry
  future: HistoryEntry[]
}

interface HistoryActions {
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean
  revertToHistoryState: (index: number) => void
}

// MAX for each individual workflow
const MAX_HISTORY_LENGTH = 20

// Types for workflow store with history management capabilities
export interface WorkflowStoreWithHistory extends WorkflowStore, HistoryActions {
  history: WorkflowHistory
  revertToDeployedState: (deployedState: WorkflowState) => void
}

// Higher-order store middleware that adds undo/redo functionality
export const withHistory = (
  config: StateCreator<WorkflowStoreWithHistory>
): StateCreator<WorkflowStoreWithHistory> => {
  return (set, get, api) => {
    // Initialize store with history tracking
    const initialState = config(set, get, api)
    const initialHistoryEntry: HistoryEntry = {
      state: {
        blocks: initialState.blocks,
        edges: initialState.edges,
        loops: initialState.loops,
      },
      timestamp: Date.now(),
      action: 'Initial state',
      subblockValues: {}, // Add storage for subblock values
    }

    return {
      ...initialState,
      history: {
        past: [],
        present: initialHistoryEntry,
        future: [],
      },

      // Check if undo operation is available
      canUndo: () => get().history.past.length > 0,

      // Check if redo operation is available
      canRedo: () => get().history.future.length > 0,

      // Restore previous state from history
      undo: () => {
        const { history, ...state } = get()
        if (history.past.length === 0) return

        const previous = history.past[history.past.length - 1]
        const newPast = history.past.slice(0, history.past.length - 1)

        // Get active workflow ID for subblock handling
        const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
        if (!activeWorkflowId) return

        // Apply the state change
        set({
          ...state,
          ...previous.state,
          history: {
            past: newPast,
            present: previous,
            future: [history.present, ...history.future],
          },
          lastSaved: Date.now(),
        })

        // Restore subblock values from the previous state's snapshot
        if (previous.subblockValues && activeWorkflowId) {
          // Update the subblock store with the saved values
          useSubBlockStore.setState({
            workflowValues: {
              ...useSubBlockStore.getState().workflowValues,
              [activeWorkflowId]: previous.subblockValues,
            },
          })

          // Save to localStorage
          saveSubblockValues(activeWorkflowId, previous.subblockValues)
        }

        // Save workflow state after undo
        const currentState = get()
        saveWorkflowState(activeWorkflowId, {
          blocks: currentState.blocks,
          edges: currentState.edges,
          loops: currentState.loops,
          history: currentState.history,
          isDeployed: currentState.isDeployed,
          deployedAt: currentState.deployedAt,
          lastSaved: Date.now(),
        })
      },

      // Restore next state from history
      redo: () => {
        const { history, ...state } = get()
        if (history.future.length === 0) return

        const next = history.future[0]
        const newFuture = history.future.slice(1)

        // Get active workflow ID for subblock handling
        const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
        if (!activeWorkflowId) return

        // Apply the state change
        set({
          ...state,
          ...next.state,
          history: {
            past: [...history.past, history.present],
            present: next,
            future: newFuture,
          },
          lastSaved: Date.now(),
        })

        // Restore subblock values from the next state's snapshot
        if (next.subblockValues && activeWorkflowId) {
          // Update the subblock store with the saved values
          useSubBlockStore.setState({
            workflowValues: {
              ...useSubBlockStore.getState().workflowValues,
              [activeWorkflowId]: next.subblockValues,
            },
          })

          // Save to localStorage
          saveSubblockValues(activeWorkflowId, next.subblockValues)
        }

        // Save workflow state after redo
        const currentState = get()
        saveWorkflowState(activeWorkflowId, {
          blocks: currentState.blocks,
          edges: currentState.edges,
          loops: currentState.loops,
          history: currentState.history,
          isDeployed: currentState.isDeployed,
          deployedAt: currentState.deployedAt,
          lastSaved: Date.now(),
        })
      },

      // Reset workflow to empty state
      clear: () => {
        const newState = {
          blocks: {},
          edges: [],
          loops: {},
          history: {
            past: [],
            present: {
              state: { blocks: {}, edges: [], loops: {} },
              timestamp: Date.now(),
              action: 'Clear workflow',
              subblockValues: {},
            },
            future: [],
          },
          lastSaved: Date.now(),
        }
        set(newState)
        return newState
      },

      // Jump to specific point in history
      revertToHistoryState: (index: number) => {
        const { history, ...state } = get()
        const allStates = [...history.past, history.present, ...history.future]
        const targetState = allStates[index]

        if (!targetState) return

        // Get active workflow ID for subblock handling
        const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
        if (!activeWorkflowId) return

        const newPast = allStates.slice(0, index)
        const newFuture = allStates.slice(index + 1)

        set({
          ...state,
          ...targetState.state,
          history: {
            past: newPast,
            present: targetState,
            future: newFuture,
          },
          lastSaved: Date.now(),
        })

        // Restore subblock values from the target state's snapshot
        if (targetState.subblockValues && activeWorkflowId) {
          // Update the subblock store with the saved values
          useSubBlockStore.setState({
            workflowValues: {
              ...useSubBlockStore.getState().workflowValues,
              [activeWorkflowId]: targetState.subblockValues,
            },
          })

          // Save to localStorage
          saveSubblockValues(activeWorkflowId, targetState.subblockValues)
        }

        // Save workflow state after revert
        const currentState = get()
        saveWorkflowState(activeWorkflowId, {
          blocks: currentState.blocks,
          edges: currentState.edges,
          loops: currentState.loops,
          history: currentState.history,
          isDeployed: currentState.isDeployed,
          deployedAt: currentState.deployedAt,
          lastSaved: Date.now(),
        })
      },
    }
  }
}

// Create a new history entry with current state snapshot
export const createHistoryEntry = (state: WorkflowState, action: string): HistoryEntry => {
  // Get active workflow ID for subblock handling
  const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId

  // Create a deep copy of the state
  const stateCopy = {
    blocks: { ...state.blocks },
    edges: [...state.edges],
    loops: { ...state.loops },
  }

  // Capture the current subblock values for this workflow
  let subblockValues = {}

  if (activeWorkflowId) {
    // Get the current subblock values from the store
    const currentValues = useSubBlockStore.getState().workflowValues[activeWorkflowId] || {}

    // Create a deep copy to ensure we don't have reference issues
    subblockValues = JSON.parse(JSON.stringify(currentValues))
  }

  return {
    state: stateCopy,
    timestamp: Date.now(),
    action,
    subblockValues,
  }
}

// Add new entry to history and maintain history size limit
export const pushHistory = (
  set: (
    partial:
      | Partial<WorkflowStoreWithHistory>
      | ((state: WorkflowStoreWithHistory) => Partial<WorkflowStoreWithHistory>),
    replace?: boolean
  ) => void,
  get: () => WorkflowStoreWithHistory,
  newState: WorkflowState,
  action: string
) => {
  const { history } = get()
  const newEntry = createHistoryEntry(newState, action)

  set({
    history: {
      past: [...history.past, history.present].slice(-MAX_HISTORY_LENGTH),
      present: newEntry,
      future: [],
    },
    lastSaved: Date.now(),
  })
}
