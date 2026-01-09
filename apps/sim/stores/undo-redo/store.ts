import { createLogger } from '@sim/logger'
import type { Edge } from 'reactflow'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { UNDO_REDO_OPERATIONS } from '@/socket/constants'
import type {
  BatchAddBlocksOperation,
  BatchAddEdgesOperation,
  BatchMoveBlocksOperation,
  BatchRemoveBlocksOperation,
  BatchRemoveEdgesOperation,
  BatchUpdateParentOperation,
  Operation,
  OperationEntry,
  UndoRedoState,
} from '@/stores/undo-redo/types'
import type { BlockState } from '@/stores/workflows/workflow/types'

const logger = createLogger('UndoRedoStore')
const DEFAULT_CAPACITY = 100
const MAX_STACKS = 5

let recordingSuspendDepth = 0

function isRecordingSuspended(): boolean {
  return recordingSuspendDepth > 0
}

/**
 * Temporarily suspends undo/redo recording while the provided callback runs.
 *
 * @param callback - Function to execute while recording is disabled.
 * @returns The callback result.
 */
export async function runWithUndoRedoRecordingSuspended<T>(
  callback: () => Promise<T> | T
): Promise<T> {
  recordingSuspendDepth += 1
  try {
    return await Promise.resolve(callback())
  } finally {
    recordingSuspendDepth = Math.max(0, recordingSuspendDepth - 1)
  }
}

function getStackKey(workflowId: string, userId: string): string {
  return `${workflowId}:${userId}`
}

/**
 * Custom storage adapter for Zustand's persist middleware.
 * We need this wrapper to gracefully handle 'QuotaExceededError' when localStorage is full,
 * Without this, the default storage engine would throw and crash the application.
 * and to properly handle SSR/Node.js environments.
 */
const safeStorageAdapter = {
  getItem: (name: string): string | null => {
    if (typeof localStorage === 'undefined') return null
    try {
      return localStorage.getItem(name)
    } catch (e) {
      logger.warn('Failed to read from localStorage', e)
      return null
    }
  },
  setItem: (name: string, value: string): void => {
    if (typeof localStorage === 'undefined') return
    try {
      localStorage.setItem(name, value)
    } catch (e) {
      // Log warning but don't crash - this handles QuotaExceededError
      logger.warn('Failed to save to localStorage', e)
    }
  },
  removeItem: (name: string): void => {
    if (typeof localStorage === 'undefined') return
    try {
      localStorage.removeItem(name)
    } catch (e) {
      logger.warn('Failed to remove from localStorage', e)
    }
  },
}

function isOperationApplicable(
  operation: Operation,
  graph: { blocksById: Record<string, BlockState>; edgesById: Record<string, Edge> }
): boolean {
  switch (operation.type) {
    case UNDO_REDO_OPERATIONS.BATCH_REMOVE_BLOCKS: {
      const op = operation as BatchRemoveBlocksOperation
      return op.data.blockSnapshots.every((block) => Boolean(graph.blocksById[block.id]))
    }
    case UNDO_REDO_OPERATIONS.BATCH_ADD_BLOCKS: {
      const op = operation as BatchAddBlocksOperation
      return op.data.blockSnapshots.every((block) => !graph.blocksById[block.id])
    }
    case UNDO_REDO_OPERATIONS.BATCH_MOVE_BLOCKS: {
      const op = operation as BatchMoveBlocksOperation
      return op.data.moves.every((move) => Boolean(graph.blocksById[move.blockId]))
    }
    case UNDO_REDO_OPERATIONS.UPDATE_PARENT: {
      const blockId = operation.data.blockId
      return Boolean(graph.blocksById[blockId])
    }
    case UNDO_REDO_OPERATIONS.BATCH_UPDATE_PARENT: {
      const op = operation as BatchUpdateParentOperation
      return op.data.updates.every((u) => Boolean(graph.blocksById[u.blockId]))
    }
    case UNDO_REDO_OPERATIONS.BATCH_REMOVE_EDGES: {
      const op = operation as BatchRemoveEdgesOperation
      return op.data.edgeSnapshots.every((edge) => Boolean(graph.edgesById[edge.id]))
    }
    case UNDO_REDO_OPERATIONS.BATCH_ADD_EDGES: {
      const op = operation as BatchAddEdgesOperation
      return op.data.edgeSnapshots.every((edge) => !graph.edgesById[edge.id])
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
        if (isRecordingSuspended()) {
          logger.debug('Skipped push while undo/redo recording suspended', {
            workflowId,
            userId,
            operationType: entry.operation.type,
          })
          return
        }

        const key = getStackKey(workflowId, userId)
        const state = get()
        const currentStacks = { ...state.stacks }

        // Limit number of stacks
        const stackKeys = Object.keys(currentStacks)
        if (stackKeys.length >= MAX_STACKS && !currentStacks[key]) {
          let oldestKey: string | null = null
          let oldestTime = Number.POSITIVE_INFINITY

          for (const k of stackKeys) {
            const t = currentStacks[k].lastUpdated ?? 0
            if (t < oldestTime) {
              oldestTime = t
              oldestKey = k
            }
          }

          if (oldestKey) {
            delete currentStacks[oldestKey]
          }
        }

        const stack = currentStacks[key] || { undo: [], redo: [] }

        // Prevent duplicate diff operations (apply-diff, accept-diff, reject-diff)
        if (['apply-diff', 'accept-diff', 'reject-diff'].includes(entry.operation.type)) {
          const lastEntry = stack.undo[stack.undo.length - 1]
          if (lastEntry && lastEntry.operation.type === entry.operation.type) {
            // Check if it's a duplicate by comparing the relevant state data
            const lastData = lastEntry.operation.data as any
            const newData = entry.operation.data as any

            // For each diff operation type, check the relevant state
            let isDuplicate = false
            if (entry.operation.type === 'apply-diff') {
              isDuplicate =
                JSON.stringify(lastData.baselineSnapshot?.blocks) ===
                  JSON.stringify(newData.baselineSnapshot?.blocks) &&
                JSON.stringify(lastData.proposedState?.blocks) ===
                  JSON.stringify(newData.proposedState?.blocks)
            } else if (entry.operation.type === 'accept-diff') {
              isDuplicate =
                JSON.stringify(lastData.afterAccept?.blocks) ===
                JSON.stringify(newData.afterAccept?.blocks)
            } else if (entry.operation.type === 'reject-diff') {
              isDuplicate =
                JSON.stringify(lastData.afterReject?.blocks) ===
                JSON.stringify(newData.afterReject?.blocks)
            }

            if (isDuplicate) {
              logger.debug('Skipping duplicate diff operation', {
                type: entry.operation.type,
                workflowId,
                userId,
              })
              return
            }
          }
        }

        // Coalesce consecutive batch-move-blocks operations for overlapping blocks
        if (entry.operation.type === 'batch-move-blocks') {
          const incoming = entry.operation as BatchMoveBlocksOperation
          const last = stack.undo[stack.undo.length - 1]

          // Skip no-op moves (all moves have same before/after)
          const allNoOp = incoming.data.moves.every((move) => {
            const sameParent = (move.before.parentId ?? null) === (move.after.parentId ?? null)
            return move.before.x === move.after.x && move.before.y === move.after.y && sameParent
          })
          if (allNoOp) {
            logger.debug('Skipped no-op batch move push')
            return
          }

          if (
            last &&
            last.operation.type === 'batch-move-blocks' &&
            last.inverse.type === 'batch-move-blocks'
          ) {
            const prev = last.operation as BatchMoveBlocksOperation
            const prevBlockIds = new Set(prev.data.moves.map((m) => m.blockId))
            const incomingBlockIds = new Set(incoming.data.moves.map((m) => m.blockId))

            // Check if same set of blocks
            const sameBlocks =
              prevBlockIds.size === incomingBlockIds.size &&
              [...prevBlockIds].every((id) => incomingBlockIds.has(id))

            if (sameBlocks) {
              // Merge: keep earliest before, latest after for each block
              const mergedMoves = incoming.data.moves.map((incomingMove) => {
                const prevMove = prev.data.moves.find((m) => m.blockId === incomingMove.blockId)!
                return {
                  blockId: incomingMove.blockId,
                  before: prevMove.before,
                  after: incomingMove.after,
                }
              })

              // Check if all moves result in same position (net no-op)
              const allSameAfter = mergedMoves.every((move) => {
                const sameParent = (move.before.parentId ?? null) === (move.after.parentId ?? null)
                return (
                  move.before.x === move.after.x && move.before.y === move.after.y && sameParent
                )
              })

              const newUndoCoalesced: OperationEntry[] = allSameAfter
                ? stack.undo.slice(0, -1)
                : (() => {
                    const op = entry.operation as BatchMoveBlocksOperation
                    const inv = entry.inverse as BatchMoveBlocksOperation
                    const newEntry: OperationEntry = {
                      id: entry.id,
                      createdAt: entry.createdAt,
                      operation: {
                        id: op.id,
                        type: 'batch-move-blocks',
                        timestamp: op.timestamp,
                        workflowId,
                        userId,
                        data: { moves: mergedMoves },
                      },
                      inverse: {
                        id: inv.id,
                        type: 'batch-move-blocks',
                        timestamp: inv.timestamp,
                        workflowId,
                        userId,
                        data: {
                          moves: mergedMoves.map((m) => ({
                            blockId: m.blockId,
                            before: m.after,
                            after: m.before,
                          })),
                        },
                      },
                    }
                    return [...stack.undo.slice(0, -1), newEntry]
                  })()

              currentStacks[key] = {
                undo: newUndoCoalesced,
                redo: [],
                lastUpdated: Date.now(),
              }

              set({ stacks: currentStacks })

              logger.debug('Coalesced consecutive batch move operations', {
                workflowId,
                userId,
                blockCount: mergedMoves.length,
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

        currentStacks[key] = {
          undo: newUndo,
          redo: [],
          lastUpdated: Date.now(),
        }

        set({ stacks: currentStacks })

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
            [key]: {
              undo: newUndo,
              redo: newRedo,
              lastUpdated: Date.now(),
            },
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
            [key]: {
              undo: newUndo,
              redo: newRedo,
              lastUpdated: Date.now(),
            },
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
            lastUpdated: stack.lastUpdated,
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
              [key]: { ...stack, undo: validUndo, redo: validRedo },
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
      storage: createJSONStorage(() => safeStorageAdapter),
      partialize: (state) => ({
        stacks: state.stacks,
        capacity: state.capacity,
      }),
    }
  )
)
