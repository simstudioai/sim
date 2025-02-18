import { StateCreator } from 'zustand'
import { HistoryActions, HistoryEntry, WorkflowHistory } from './history-types'
import { WorkflowState, WorkflowStore } from './types'

// MAX for each individual workflow
const MAX_HISTORY_LENGTH = 20

// Types for workflow store with history management capabilities
export interface WorkflowStoreWithHistory extends WorkflowStore, HistoryActions {
  history: WorkflowHistory
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

        set({
          ...state,
          ...previous.state,
          history: {
            past: newPast,
            present: previous,
            future: [history.present, ...history.future],
          },
        })
      },

      // Restore next state from history
      redo: () => {
        const { history, ...state } = get()
        if (history.future.length === 0) return

        const next = history.future[0]
        const newFuture = history.future.slice(1)

        set({
          ...state,
          ...next.state,
          history: {
            past: [...history.past, history.present],
            present: next,
            future: newFuture,
          },
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
            },
            future: [],
          },
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
        })
      },
    }
  }
}

// Create a new history entry with current state snapshot
export const createHistoryEntry = (state: WorkflowState, action: string): HistoryEntry => ({
  state: {
    blocks: { ...state.blocks },
    edges: [...state.edges],
    loops: { ...state.loops },
  },
  timestamp: Date.now(),
  action,
})

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
  })
}
