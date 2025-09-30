import type { Edge } from 'reactflow'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console/logger'
import type { BlockState } from '@/stores/workflows/workflow/types'
import type {
  MoveBlockOperation,
  Operation,
  OperationEntry,
  RemoveBlockOperation,
  RemoveEdgeOperation,
  UndoRedoState,
} from './types'

const logger = createLogger('UndoRedoStore')
const DEFAULT_CAPACITY = 15

function getStackKey(workflowId: string, userId: string): string {
  return `${workflowId}:${userId}`
}

function isOperationApplicable(
  operation: Operation,
  graph: { blocksById: Record<string, BlockState>; edgesById: Record<string, Edge> }
): boolean {
  switch (operation.type) {
    case 'remove-block': {
      const op = operation as RemoveBlockOperation
      return Boolean(graph.blocksById[op.data.blockId])
    }
    case 'add-block': {
      const blockId = operation.data.blockId
      return !graph.blocksById[blockId]
    }
    case 'move-block': {
      const op = operation as MoveBlockOperation
      return Boolean(graph.blocksById[op.data.blockId])
    }
    case 'update-parent': {
      const blockId = operation.data.blockId
      return Boolean(graph.blocksById[blockId])
    }
    case 'duplicate-block': {
      const duplicatedId = operation.data.duplicatedBlockId
      return Boolean(graph.blocksById[duplicatedId])
    }
    case 'remove-edge': {
      const op = operation as RemoveEdgeOperation
      return Boolean(graph.edgesById[op.data.edgeId])
    }
    case 'add-edge': {
      const edgeId = operation.data.edgeId
      return !graph.edgesById[edgeId]
    }
    case 'add-subflow':
    case 'remove-subflow': {
      const subflowId = operation.data.subflowId
      return operation.type === 'remove-subflow'
        ? Boolean(graph.blocksById[subflowId])
        : !graph.blocksById[subflowId]
    }
    default:
      return true
  }
}

export const useUndoRedoStore = create<UndoRedoState>()(
  persist(
    (set, get) => ({
      stacks: {},
      capacity: DEFAULT_CAPACITY,

      push: (workflowId: string, userId: string, entry: OperationEntry) => {
        const key = getStackKey(workflowId, userId)
        const state = get()
        const stack = state.stacks[key] || { undo: [], redo: [] }

        // Coalesce consecutive move-block operations for the same block
        if (entry.operation.type === 'move-block') {
          const incoming = entry.operation as MoveBlockOperation
          const last = stack.undo[stack.undo.length - 1]

          // Skip no-op moves
          const b1 = incoming.data.before
          const a1 = incoming.data.after
          const sameParent = (b1.parentId ?? null) === (a1.parentId ?? null)
          if (b1.x === a1.x && b1.y === a1.y && sameParent) {
            logger.debug('Skipped no-op move push')
            return
          }

          if (last && last.operation.type === 'move-block' && last.inverse.type === 'move-block') {
            const prev = last.operation as MoveBlockOperation
            if (prev.data.blockId === incoming.data.blockId) {
              // Merge: keep earliest before, latest after
              const mergedBefore = prev.data.before
              const mergedAfter = incoming.data.after

              const sameAfter =
                mergedBefore.x === mergedAfter.x &&
                mergedBefore.y === mergedAfter.y &&
                (mergedBefore.parentId ?? null) === (mergedAfter.parentId ?? null)

              const newUndoCoalesced: OperationEntry[] = sameAfter
                ? stack.undo.slice(0, -1)
                : (() => {
                    const op = entry.operation as MoveBlockOperation
                    const inv = entry.inverse as MoveBlockOperation
                    const newEntry: OperationEntry = {
                      id: entry.id,
                      createdAt: entry.createdAt,
                      operation: {
                        id: op.id,
                        type: 'move-block',
                        timestamp: op.timestamp,
                        workflowId,
                        userId,
                        data: {
                          blockId: incoming.data.blockId,
                          before: mergedBefore,
                          after: mergedAfter,
                        },
                      },
                      inverse: {
                        id: inv.id,
                        type: 'move-block',
                        timestamp: inv.timestamp,
                        workflowId,
                        userId,
                        data: {
                          blockId: incoming.data.blockId,
                          before: mergedAfter,
                          after: mergedBefore,
                        },
                      },
                    }
                    return [...stack.undo.slice(0, -1), newEntry]
                  })()

              set({
                stacks: {
                  ...state.stacks,
                  [key]: { undo: newUndoCoalesced, redo: [] },
                },
              })

              logger.debug('Coalesced consecutive move operations', {
                workflowId,
                userId,
                blockId: incoming.data.blockId,
                undoSize: newUndoCoalesced.length,
              })
              return
            }
          }
        }

        const newUndo = [...stack.undo, entry]
        if (newUndo.length > state.capacity) {
          newUndo.shift()
        }

        set({
          stacks: {
            ...state.stacks,
            [key]: { undo: newUndo, redo: [] },
          },
        })

        logger.debug('Pushed operation to undo stack', {
          workflowId,
          userId,
          operationType: entry.operation.type,
          undoSize: newUndo.length,
        })
      },

      undo: (workflowId: string, userId: string) => {
        const key = getStackKey(workflowId, userId)
        const state = get()
        const stack = state.stacks[key]

        if (!stack || stack.undo.length === 0) {
          return null
        }

        const entry = stack.undo[stack.undo.length - 1]
        const newUndo = stack.undo.slice(0, -1)
        const newRedo = [...stack.redo, entry]

        if (newRedo.length > state.capacity) {
          newRedo.shift()
        }

        set({
          stacks: {
            ...state.stacks,
            [key]: { undo: newUndo, redo: newRedo },
          },
        })

        logger.debug('Undo operation', {
          workflowId,
          userId,
          operationType: entry.operation.type,
          undoSize: newUndo.length,
          redoSize: newRedo.length,
        })

        return entry
      },

      redo: (workflowId: string, userId: string) => {
        const key = getStackKey(workflowId, userId)
        const state = get()
        const stack = state.stacks[key]

        if (!stack || stack.redo.length === 0) {
          return null
        }

        const entry = stack.redo[stack.redo.length - 1]
        const newRedo = stack.redo.slice(0, -1)
        const newUndo = [...stack.undo, entry]

        if (newUndo.length > state.capacity) {
          newUndo.shift()
        }

        set({
          stacks: {
            ...state.stacks,
            [key]: { undo: newUndo, redo: newRedo },
          },
        })

        logger.debug('Redo operation', {
          workflowId,
          userId,
          operationType: entry.operation.type,
          undoSize: newUndo.length,
          redoSize: newRedo.length,
        })

        return entry
      },

      clear: (workflowId: string, userId: string) => {
        const key = getStackKey(workflowId, userId)
        const state = get()
        const { [key]: _, ...rest } = state.stacks

        set({ stacks: rest })

        logger.debug('Cleared undo/redo stacks', { workflowId, userId })
      },

      clearRedo: (workflowId: string, userId: string) => {
        const key = getStackKey(workflowId, userId)
        const state = get()
        const stack = state.stacks[key]

        if (!stack) return

        set({
          stacks: {
            ...state.stacks,
            [key]: { ...stack, redo: [] },
          },
        })

        logger.debug('Cleared redo stack', { workflowId, userId })
      },

      getStackSizes: (workflowId: string, userId: string) => {
        const key = getStackKey(workflowId, userId)
        const state = get()
        const stack = state.stacks[key]

        if (!stack) {
          return { undoSize: 0, redoSize: 0 }
        }

        return {
          undoSize: stack.undo.length,
          redoSize: stack.redo.length,
        }
      },

      setCapacity: (capacity: number) => {
        const state = get()
        const newStacks: typeof state.stacks = {}

        for (const [key, stack] of Object.entries(state.stacks)) {
          newStacks[key] = {
            undo: stack.undo.slice(-capacity),
            redo: stack.redo.slice(-capacity),
          }
        }

        set({ capacity, stacks: newStacks })

        logger.debug('Set capacity', { capacity })
      },

      pruneInvalidEntries: (
        workflowId: string,
        userId: string,
        graph: { blocksById: Record<string, BlockState>; edgesById: Record<string, Edge> }
      ) => {
        const key = getStackKey(workflowId, userId)
        const state = get()
        const stack = state.stacks[key]

        if (!stack) return

        const originalUndoCount = stack.undo.length
        const originalRedoCount = stack.redo.length

        const validUndo = stack.undo.filter((entry) => isOperationApplicable(entry.inverse, graph))

        const validRedo = stack.redo.filter((entry) =>
          isOperationApplicable(entry.operation, graph)
        )

        const prunedUndoCount = originalUndoCount - validUndo.length
        const prunedRedoCount = originalRedoCount - validRedo.length

        if (prunedUndoCount > 0 || prunedRedoCount > 0) {
          set({
            stacks: {
              ...state.stacks,
              [key]: { undo: validUndo, redo: validRedo },
            },
          })

          logger.debug('Pruned invalid entries', {
            workflowId,
            userId,
            prunedUndo: prunedUndoCount,
            prunedRedo: prunedRedoCount,
            remainingUndo: validUndo.length,
            remainingRedo: validRedo.length,
          })
        }
      },
    }),
    {
      name: 'workflow-undo-redo',
      partialize: (state) => ({
        stacks: state.stacks,
        capacity: state.capacity,
      }),
    }
  )
)
