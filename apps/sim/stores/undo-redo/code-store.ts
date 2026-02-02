import { create } from 'zustand'
import { createJSONStorage, devtools, persist } from 'zustand/middleware'
import { codeUndoRedoStorage } from '@/stores/undo-redo/code-storage'

interface CodeUndoRedoEntry {
  id: string
  createdAt: number
  workflowId: string
  blockId: string
  subBlockId: string
  before: string
  after: string
}

interface CodeUndoRedoStack {
  undo: CodeUndoRedoEntry[]
  redo: CodeUndoRedoEntry[]
  lastUpdated?: number
}

interface CodeUndoRedoState {
  stacks: Record<string, CodeUndoRedoStack>
  capacity: number
  push: (entry: CodeUndoRedoEntry) => void
  undo: (workflowId: string, blockId: string, subBlockId: string) => CodeUndoRedoEntry | null
  redo: (workflowId: string, blockId: string, subBlockId: string) => CodeUndoRedoEntry | null
  clear: (workflowId: string, blockId: string, subBlockId: string) => void
}

const DEFAULT_CAPACITY = 500
const MAX_STACKS = 50

function getStackKey(workflowId: string, blockId: string, subBlockId: string): string {
  return `${workflowId}:${blockId}:${subBlockId}`
}

const initialState = {
  stacks: {} as Record<string, CodeUndoRedoStack>,
  capacity: DEFAULT_CAPACITY,
}

export const useCodeUndoRedoStore = create<CodeUndoRedoState>()(
  devtools(
    persist(
      (set, get) => ({
        ...initialState,
        push: (entry) => {
          if (entry.before === entry.after) return

          const state = get()
          const key = getStackKey(entry.workflowId, entry.blockId, entry.subBlockId)
          const currentStacks = { ...state.stacks }

          const stackKeys = Object.keys(currentStacks)
          if (stackKeys.length >= MAX_STACKS && !currentStacks[key]) {
            let oldestKey: string | null = null
            let oldestTime = Number.POSITIVE_INFINITY

            for (const stackKey of stackKeys) {
              const t = currentStacks[stackKey].lastUpdated ?? 0
              if (t < oldestTime) {
                oldestTime = t
                oldestKey = stackKey
              }
            }

            if (oldestKey) {
              delete currentStacks[oldestKey]
            }
          }

          const stack = currentStacks[key] || { undo: [], redo: [] }

          const newUndo = [...stack.undo, entry]
          if (newUndo.length > state.capacity) {
            newUndo.shift()
          }

          currentStacks[key] = {
            undo: newUndo,
            redo: [],
            lastUpdated: Date.now(),
          }

          set({ stacks: currentStacks })
        },
        undo: (workflowId, blockId, subBlockId) => {
          const key = getStackKey(workflowId, blockId, subBlockId)
          const state = get()
          const stack = state.stacks[key]
          if (!stack || stack.undo.length === 0) return null

          const entry = stack.undo[stack.undo.length - 1]
          const newUndo = stack.undo.slice(0, -1)
          const newRedo = [...stack.redo, entry]

          set({
            stacks: {
              ...state.stacks,
              [key]: {
                undo: newUndo,
                redo: newRedo.slice(-state.capacity),
                lastUpdated: Date.now(),
              },
            },
          })

          return entry
        },
        redo: (workflowId, blockId, subBlockId) => {
          const key = getStackKey(workflowId, blockId, subBlockId)
          const state = get()
          const stack = state.stacks[key]
          if (!stack || stack.redo.length === 0) return null

          const entry = stack.redo[stack.redo.length - 1]
          const newRedo = stack.redo.slice(0, -1)
          const newUndo = [...stack.undo, entry]

          set({
            stacks: {
              ...state.stacks,
              [key]: {
                undo: newUndo.slice(-state.capacity),
                redo: newRedo,
                lastUpdated: Date.now(),
              },
            },
          })

          return entry
        },
        clear: (workflowId, blockId, subBlockId) => {
          const key = getStackKey(workflowId, blockId, subBlockId)
          const state = get()
          const { [key]: _, ...rest } = state.stacks
          set({ stacks: rest })
        },
      }),
      {
        name: 'code-undo-redo-store',
        storage: createJSONStorage(() => codeUndoRedoStorage),
        partialize: (state) => ({
          stacks: state.stacks,
          capacity: state.capacity,
        }),
      }
    ),
    { name: 'code-undo-redo-store' }
  )
)
