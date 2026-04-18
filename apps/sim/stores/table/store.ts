/**
 * Zustand store for table undo/redo stacks.
 * Ephemeral — no persistence. Stacks are keyed by tableId.
 */

import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { generateShortId } from '@/lib/core/utils/uuid'
import type { TableUndoAction, TableUndoStacks, TableUndoState, UndoEntry } from './types'

const STACK_CAPACITY = 100
const EMPTY_STACKS: TableUndoStacks = { undo: [], redo: [] }

let undoRedoInProgress = false

function patchRowIdInEntry(entry: UndoEntry, oldRowId: string, newRowId: string): UndoEntry {
  const { action } = entry
  switch (action.type) {
    case 'update-cell':
      if (action.rowId === oldRowId) {
        return { ...entry, action: { ...action, rowId: newRowId } }
      }
      break
    case 'clear-cells': {
      const hasMatch = action.cells.some((c) => c.rowId === oldRowId)
      if (hasMatch) {
        const patched = action.cells.map((c) =>
          c.rowId === oldRowId ? { ...c, rowId: newRowId } : c
        )
        return { ...entry, action: { ...action, cells: patched } }
      }
      break
    }
    case 'update-cells': {
      const hasMatch = action.cells.some((c) => c.rowId === oldRowId)
      if (hasMatch) {
        const patched = action.cells.map((c) =>
          c.rowId === oldRowId ? { ...c, rowId: newRowId } : c
        )
        return { ...entry, action: { ...action, cells: patched } }
      }
      break
    }
    case 'create-row':
      if (action.rowId === oldRowId) {
        return { ...entry, action: { ...action, rowId: newRowId } }
      }
      break
    case 'create-rows': {
      const hasMatch = action.rows.some((r) => r.rowId === oldRowId)
      if (hasMatch) {
        const patched = action.rows.map((r) =>
          r.rowId === oldRowId ? { ...r, rowId: newRowId } : r
        )
        return { ...entry, action: { ...action, rows: patched } }
      }
      break
    }
    case 'delete-rows': {
      const hasMatch = action.rows.some((r) => r.rowId === oldRowId)
      if (hasMatch) {
        const patched = action.rows.map((r) =>
          r.rowId === oldRowId ? { ...r, rowId: newRowId } : r
        )
        return { ...entry, action: { ...action, rows: patched } }
      }
      break
    }
    case 'delete-column': {
      const hasMatch = action.cellData.some((c) => c.rowId === oldRowId)
      if (hasMatch) {
        const patched = action.cellData.map((c) =>
          c.rowId === oldRowId ? { ...c, rowId: newRowId } : c
        )
        return { ...entry, action: { ...action, cellData: patched } }
      }
      break
    }
  }
  return entry
}

/**
 * Run a function without recording undo entries.
 * Used by the hook when executing undo/redo mutations to prevent recursive recording.
 */
export function runWithoutRecording<T>(fn: () => T): T {
  undoRedoInProgress = true
  try {
    return fn()
  } finally {
    undoRedoInProgress = false
  }
}

export const useTableUndoStore = create<TableUndoState>()(
  devtools(
    (set, get) => ({
      stacks: {},

      push: (tableId: string, action: TableUndoAction) => {
        if (undoRedoInProgress) return

        const entry: UndoEntry = { id: generateShortId(), action, timestamp: Date.now() }

        set((state) => {
          const current = state.stacks[tableId] ?? EMPTY_STACKS
          const undoStack = [entry, ...current.undo].slice(0, STACK_CAPACITY)
          return {
            stacks: {
              ...state.stacks,
              [tableId]: { undo: undoStack, redo: [] },
            },
          }
        })
      },

      popUndo: (tableId: string) => {
        const current = get().stacks[tableId] ?? EMPTY_STACKS
        if (current.undo.length === 0) return null

        const [entry, ...rest] = current.undo
        set((state) => ({
          stacks: {
            ...state.stacks,
            [tableId]: {
              undo: rest,
              redo: [entry, ...current.redo],
            },
          },
        }))
        return entry
      },

      popRedo: (tableId: string) => {
        const current = get().stacks[tableId] ?? EMPTY_STACKS
        if (current.redo.length === 0) return null

        const [entry, ...rest] = current.redo
        set((state) => ({
          stacks: {
            ...state.stacks,
            [tableId]: {
              undo: [entry, ...current.undo],
              redo: rest,
            },
          },
        }))
        return entry
      },

      patchRedoRowId: (tableId: string, oldRowId: string, newRowId: string) => {
        set((state) => {
          const stacks = state.stacks[tableId]
          if (!stacks) return state
          const patchedRedo = stacks.redo.map((entry) =>
            patchRowIdInEntry(entry, oldRowId, newRowId)
          )
          return {
            stacks: {
              ...state.stacks,
              [tableId]: { ...stacks, redo: patchedRedo },
            },
          }
        })
      },

      patchUndoRowId: (tableId: string, oldRowId: string, newRowId: string) => {
        set((state) => {
          const stacks = state.stacks[tableId]
          if (!stacks) return state
          const patchedUndo = stacks.undo.map((entry) =>
            patchRowIdInEntry(entry, oldRowId, newRowId)
          )
          return {
            stacks: {
              ...state.stacks,
              [tableId]: { ...stacks, undo: patchedUndo },
            },
          }
        })
      },

      clear: (tableId: string) => {
        set((state) => {
          const { [tableId]: _, ...rest } = state.stacks
          return { stacks: rest }
        })
      },
    }),
    { name: 'table-undo-store' }
  )
)
