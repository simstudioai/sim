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
        const stacks = get().stacks[tableId]
        if (!stacks) return

        const patchedRedo = stacks.redo.map((entry) => {
          const { action } = entry
          if (action.type === 'delete-rows') {
            const patchedRows = action.rows.map((r) =>
              r.rowId === oldRowId ? { ...r, rowId: newRowId } : r
            )
            return { ...entry, action: { ...action, rows: patchedRows } }
          }
          return entry
        })

        set((state) => ({
          stacks: {
            ...state.stacks,
            [tableId]: { ...stacks, redo: patchedRedo },
          },
        }))
      },

      patchUndoRowId: (tableId: string, oldRowId: string, newRowId: string) => {
        const stacks = get().stacks[tableId]
        if (!stacks) return

        const patchedUndo = stacks.undo.map((entry) => {
          const { action } = entry
          if (action.type === 'create-row' && action.rowId === oldRowId) {
            return { ...entry, action: { ...action, rowId: newRowId } }
          }
          return entry
        })

        set((state) => ({
          stacks: {
            ...state.stacks,
            [tableId]: { ...stacks, undo: patchedUndo },
          },
        }))
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
