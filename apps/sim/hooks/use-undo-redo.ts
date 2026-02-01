import { useCallback } from 'react'
import { createLogger } from '@sim/logger'
import type { Edge } from 'reactflow'
import { useSession } from '@/lib/auth/auth-client'
import { enqueueReplaceWorkflowState } from '@/lib/workflows/operations/socket-operations'
import {
  BLOCK_OPERATIONS,
  BLOCKS_OPERATIONS,
  EDGE_OPERATIONS,
  EDGES_OPERATIONS,
  OPERATION_TARGETS,
  UNDO_REDO_OPERATIONS,
} from '@/socket/constants'
import { useOperationQueue } from '@/stores/operation-queue/store'
import {
  type BatchAddBlocksOperation,
  type BatchAddEdgesOperation,
  type BatchMoveBlocksOperation,
  type BatchRemoveBlocksOperation,
  type BatchRemoveEdgesOperation,
  type BatchToggleEnabledOperation,
  type BatchToggleHandlesOperation,
  type BatchToggleLockedOperation,
  type BatchUpdateParentOperation,
  captureLatestEdges,
  captureLatestSubBlockValues,
  createOperationEntry,
  runWithUndoRedoRecordingSuspended,
  type UpdateParentOperation,
  useUndoRedoStore,
} from '@/stores/undo-redo'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { BlockState } from '@/stores/workflows/workflow/types'

const logger = createLogger('UndoRedo')

export function useUndoRedo() {
  const { data: session } = useSession()
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const { addToQueue } = useOperationQueue()

  const userId = session?.user?.id || 'unknown'

  const recordBatchAddBlocks = useCallback(
    (
      blockSnapshots: BlockState[],
      edgeSnapshots: Edge[] = [],
      subBlockValues: Record<string, Record<string, unknown>> = {}
    ) => {
      if (!activeWorkflowId || blockSnapshots.length === 0) return

      const operation: BatchAddBlocksOperation = {
        id: crypto.randomUUID(),
        type: UNDO_REDO_OPERATIONS.BATCH_ADD_BLOCKS,
        timestamp: Date.now(),
        workflowId: activeWorkflowId,
        userId,
        data: {
          blockSnapshots,
          edgeSnapshots,
          subBlockValues,
        },
      }

      const inverse: BatchRemoveBlocksOperation = {
        id: crypto.randomUUID(),
        type: UNDO_REDO_OPERATIONS.BATCH_REMOVE_BLOCKS,
        timestamp: Date.now(),
        workflowId: activeWorkflowId,
        userId,
        data: {
          blockSnapshots,
          edgeSnapshots,
          subBlockValues,
        },
      }

      const entry = createOperationEntry(operation, inverse)
      useUndoRedoStore.getState().push(activeWorkflowId, userId, entry)

      logger.debug('Recorded batch add blocks', {
        blockCount: blockSnapshots.length,
        edgeCount: edgeSnapshots.length,
        workflowId: activeWorkflowId,
      })
    },
    [activeWorkflowId, userId]
  )

  const recordBatchRemoveBlocks = useCallback(
    (
      blockSnapshots: BlockState[],
      edgeSnapshots: Edge[] = [],
      subBlockValues: Record<string, Record<string, unknown>> = {}
    ) => {
      if (!activeWorkflowId || blockSnapshots.length === 0) return

      const operation: BatchRemoveBlocksOperation = {
        id: crypto.randomUUID(),
        type: UNDO_REDO_OPERATIONS.BATCH_REMOVE_BLOCKS,
        timestamp: Date.now(),
        workflowId: activeWorkflowId,
        userId,
        data: {
          blockSnapshots,
          edgeSnapshots,
          subBlockValues,
        },
      }

      const inverse: BatchAddBlocksOperation = {
        id: crypto.randomUUID(),
        type: UNDO_REDO_OPERATIONS.BATCH_ADD_BLOCKS,
        timestamp: Date.now(),
        workflowId: activeWorkflowId,
        userId,
        data: {
          blockSnapshots,
          edgeSnapshots,
          subBlockValues,
        },
      }

      const entry = createOperationEntry(operation, inverse)
      useUndoRedoStore.getState().push(activeWorkflowId, userId, entry)

      logger.debug('Recorded batch remove blocks', {
        blockCount: blockSnapshots.length,
        edgeCount: edgeSnapshots.length,
        workflowId: activeWorkflowId,
      })
    },
    [activeWorkflowId, userId]
  )

  const recordAddEdge = useCallback(
    (edgeId: string) => {
      if (!activeWorkflowId) return

      const edgeSnapshot = useWorkflowStore.getState().edges.find((e) => e.id === edgeId)
      if (!edgeSnapshot) {
        logger.warn('Edge not found when recording add edge', { edgeId })
        return
      }

      const operation: BatchAddEdgesOperation = {
        id: crypto.randomUUID(),
        type: UNDO_REDO_OPERATIONS.BATCH_ADD_EDGES,
        timestamp: Date.now(),
        workflowId: activeWorkflowId,
        userId,
        data: { edgeSnapshots: [edgeSnapshot] },
      }

      const inverse: BatchRemoveEdgesOperation = {
        id: crypto.randomUUID(),
        type: UNDO_REDO_OPERATIONS.BATCH_REMOVE_EDGES,
        timestamp: Date.now(),
        workflowId: activeWorkflowId,
        userId,
        data: { edgeSnapshots: [edgeSnapshot] },
      }

      const entry = createOperationEntry(operation, inverse)
      useUndoRedoStore.getState().push(activeWorkflowId, userId, entry)

      logger.debug('Recorded add edge', { edgeId, workflowId: activeWorkflowId })
    },
    [activeWorkflowId, userId]
  )

  const recordBatchRemoveEdges = useCallback(
    (edgeSnapshots: Edge[]) => {
      if (!activeWorkflowId || edgeSnapshots.length === 0) return

      const operation: BatchRemoveEdgesOperation = {
        id: crypto.randomUUID(),
        type: UNDO_REDO_OPERATIONS.BATCH_REMOVE_EDGES,
        timestamp: Date.now(),
        workflowId: activeWorkflowId,
        userId,
        data: {
          edgeSnapshots,
        },
      }

      const inverse: BatchAddEdgesOperation = {
        id: crypto.randomUUID(),
        type: UNDO_REDO_OPERATIONS.BATCH_ADD_EDGES,
        timestamp: Date.now(),
        workflowId: activeWorkflowId,
        userId,
        data: {
          edgeSnapshots,
        },
      }

      const entry = createOperationEntry(operation, inverse)
      useUndoRedoStore.getState().push(activeWorkflowId, userId, entry)

      logger.debug('Recorded batch remove edges', {
        edgeCount: edgeSnapshots.length,
        workflowId: activeWorkflowId,
      })
    },
    [activeWorkflowId, userId]
  )

  const recordBatchMoveBlocks = useCallback(
    (
      moves: Array<{
        blockId: string
        before: { x: number; y: number; parentId?: string }
        after: { x: number; y: number; parentId?: string }
      }>
    ) => {
      if (!activeWorkflowId || moves.length === 0) return

      const operation: BatchMoveBlocksOperation = {
        id: crypto.randomUUID(),
        type: UNDO_REDO_OPERATIONS.BATCH_MOVE_BLOCKS,
        timestamp: Date.now(),
        workflowId: activeWorkflowId,
        userId,
        data: { moves },
      }

      const inverse: BatchMoveBlocksOperation = {
        id: crypto.randomUUID(),
        type: UNDO_REDO_OPERATIONS.BATCH_MOVE_BLOCKS,
        timestamp: Date.now(),
        workflowId: activeWorkflowId,
        userId,
        data: {
          moves: moves.map((m) => ({
            blockId: m.blockId,
            before: m.after,
            after: m.before,
          })),
        },
      }

      const entry = createOperationEntry(operation, inverse)
      useUndoRedoStore.getState().push(activeWorkflowId, userId, entry)

      logger.debug('Recorded batch move', { blockCount: moves.length })
    },
    [activeWorkflowId, userId]
  )

  const recordUpdateParent = useCallback(
    (
      blockId: string,
      oldParentId: string | undefined,
      newParentId: string | undefined,
      oldPosition: { x: number; y: number },
      newPosition: { x: number; y: number },
      affectedEdges?: any[]
    ) => {
      if (!activeWorkflowId) return

      const operation: UpdateParentOperation = {
        id: crypto.randomUUID(),
        type: UNDO_REDO_OPERATIONS.UPDATE_PARENT,
        timestamp: Date.now(),
        workflowId: activeWorkflowId,
        userId,
        data: {
          blockId,
          oldParentId,
          newParentId,
          oldPosition,
          newPosition,
          affectedEdges,
        },
      }

      const inverse: UpdateParentOperation = {
        id: crypto.randomUUID(),
        type: UNDO_REDO_OPERATIONS.UPDATE_PARENT,
        timestamp: Date.now(),
        workflowId: activeWorkflowId,
        userId,
        data: {
          blockId,
          oldParentId: newParentId,
          newParentId: oldParentId,
          oldPosition: newPosition,
          newPosition: oldPosition,
          affectedEdges,
        },
      }

      const entry = createOperationEntry(operation, inverse)
      useUndoRedoStore.getState().push(activeWorkflowId, userId, entry)

      logger.debug('Recorded update parent', {
        blockId,
        oldParentId,
        newParentId,
        edgeCount: affectedEdges?.length || 0,
      })
    },
    [activeWorkflowId, userId]
  )

  const recordBatchUpdateParent = useCallback(
    (
      updates: Array<{
        blockId: string
        oldParentId?: string
        newParentId?: string
        oldPosition: { x: number; y: number }
        newPosition: { x: number; y: number }
        affectedEdges?: Edge[]
      }>
    ) => {
      if (!activeWorkflowId || updates.length === 0) return

      const operation: BatchUpdateParentOperation = {
        id: crypto.randomUUID(),
        type: UNDO_REDO_OPERATIONS.BATCH_UPDATE_PARENT,
        timestamp: Date.now(),
        workflowId: activeWorkflowId,
        userId,
        data: { updates },
      }

      const inverse: BatchUpdateParentOperation = {
        id: crypto.randomUUID(),
        type: UNDO_REDO_OPERATIONS.BATCH_UPDATE_PARENT,
        timestamp: Date.now(),
        workflowId: activeWorkflowId,
        userId,
        data: {
          updates: updates.map((u) => ({
            blockId: u.blockId,
            oldParentId: u.newParentId,
            newParentId: u.oldParentId,
            oldPosition: u.newPosition,
            newPosition: u.oldPosition,
            affectedEdges: u.affectedEdges,
          })),
        },
      }

      const entry = createOperationEntry(operation, inverse)
      useUndoRedoStore.getState().push(activeWorkflowId, userId, entry)

      logger.debug('Recorded batch update parent', {
        updateCount: updates.length,
        workflowId: activeWorkflowId,
      })
    },
    [activeWorkflowId, userId]
  )

  const recordBatchToggleEnabled = useCallback(
    (blockIds: string[], previousStates: Record<string, boolean>) => {
      if (!activeWorkflowId || blockIds.length === 0) return

      const operation: BatchToggleEnabledOperation = {
        id: crypto.randomUUID(),
        type: UNDO_REDO_OPERATIONS.BATCH_TOGGLE_ENABLED,
        timestamp: Date.now(),
        workflowId: activeWorkflowId,
        userId,
        data: { blockIds, previousStates },
      }

      const inverse: BatchToggleEnabledOperation = {
        id: crypto.randomUUID(),
        type: UNDO_REDO_OPERATIONS.BATCH_TOGGLE_ENABLED,
        timestamp: Date.now(),
        workflowId: activeWorkflowId,
        userId,
        data: { blockIds, previousStates },
      }

      const entry = createOperationEntry(operation, inverse)
      useUndoRedoStore.getState().push(activeWorkflowId, userId, entry)

      logger.debug('Recorded batch toggle enabled', { blockIds, previousStates })
    },
    [activeWorkflowId, userId]
  )

  const recordBatchToggleHandles = useCallback(
    (blockIds: string[], previousStates: Record<string, boolean>) => {
      if (!activeWorkflowId || blockIds.length === 0) return

      const operation: BatchToggleHandlesOperation = {
        id: crypto.randomUUID(),
        type: UNDO_REDO_OPERATIONS.BATCH_TOGGLE_HANDLES,
        timestamp: Date.now(),
        workflowId: activeWorkflowId,
        userId,
        data: { blockIds, previousStates },
      }

      const inverse: BatchToggleHandlesOperation = {
        id: crypto.randomUUID(),
        type: UNDO_REDO_OPERATIONS.BATCH_TOGGLE_HANDLES,
        timestamp: Date.now(),
        workflowId: activeWorkflowId,
        userId,
        data: { blockIds, previousStates },
      }

      const entry = createOperationEntry(operation, inverse)
      useUndoRedoStore.getState().push(activeWorkflowId, userId, entry)

      logger.debug('Recorded batch toggle handles', { blockIds, previousStates })
    },
    [activeWorkflowId, userId]
  )

  const recordBatchToggleLocked = useCallback(
    (blockIds: string[], previousStates: Record<string, boolean>) => {
      if (!activeWorkflowId || blockIds.length === 0) return

      const operation: BatchToggleLockedOperation = {
        id: crypto.randomUUID(),
        type: UNDO_REDO_OPERATIONS.BATCH_TOGGLE_LOCKED,
        timestamp: Date.now(),
        workflowId: activeWorkflowId,
        userId,
        data: { blockIds, previousStates },
      }

      const inverse: BatchToggleLockedOperation = {
        id: crypto.randomUUID(),
        type: UNDO_REDO_OPERATIONS.BATCH_TOGGLE_LOCKED,
        timestamp: Date.now(),
        workflowId: activeWorkflowId,
        userId,
        data: { blockIds, previousStates },
      }

      const entry = createOperationEntry(operation, inverse)
      useUndoRedoStore.getState().push(activeWorkflowId, userId, entry)

      logger.debug('Recorded batch toggle locked', { blockIds, previousStates })
    },
    [activeWorkflowId, userId]
  )

  const undo = useCallback(async () => {
    if (!activeWorkflowId) return

    await runWithUndoRedoRecordingSuspended(async () => {
      const entry = useUndoRedoStore.getState().undo(activeWorkflowId, userId)
      if (!entry) {
        logger.debug('No operations to undo')
        return
      }

      logger.info('Processing undo', {
        operationType: entry.operation.type,
        inverseType: entry.inverse.type,
        workflowId: activeWorkflowId,
      })

      const opId = crypto.randomUUID()

      switch (entry.inverse.type) {
        case UNDO_REDO_OPERATIONS.BATCH_REMOVE_BLOCKS: {
          const batchRemoveOp = entry.inverse as BatchRemoveBlocksOperation
          const { blockSnapshots } = batchRemoveOp.data
          const blockIds = blockSnapshots.map((b) => b.id)

          const existingBlockIds = blockIds.filter((id) => useWorkflowStore.getState().blocks[id])
          if (existingBlockIds.length === 0) {
            logger.debug('Undo batch-remove-blocks skipped; no blocks exist')
            break
          }

          const latestEdges = captureLatestEdges(
            useWorkflowStore.getState().edges,
            existingBlockIds
          )
          batchRemoveOp.data.edgeSnapshots = latestEdges

          const latestSubBlockValues = captureLatestSubBlockValues(
            useWorkflowStore.getState().blocks,
            activeWorkflowId,
            existingBlockIds
          )
          batchRemoveOp.data.subBlockValues = latestSubBlockValues
          ;(entry.operation as BatchAddBlocksOperation).data.subBlockValues = latestSubBlockValues

          addToQueue({
            id: opId,
            operation: {
              operation: BLOCKS_OPERATIONS.BATCH_REMOVE_BLOCKS,
              target: OPERATION_TARGETS.BLOCKS,
              payload: { ids: existingBlockIds },
            },
            workflowId: activeWorkflowId,
            userId,
          })

          useWorkflowStore.getState().batchRemoveBlocks(existingBlockIds)
          break
        }
        case UNDO_REDO_OPERATIONS.BATCH_ADD_BLOCKS: {
          // Undoing a removal: inverse is batch-add-blocks, use entry.inverse for data
          const batchAddOp = entry.inverse as BatchAddBlocksOperation
          const { blockSnapshots, edgeSnapshots, subBlockValues } = batchAddOp.data

          const blocksToAdd = blockSnapshots.filter(
            (b) => !useWorkflowStore.getState().blocks[b.id]
          )
          if (blocksToAdd.length === 0) {
            logger.debug('Undo batch-add-blocks skipped; all blocks exist')
            break
          }

          addToQueue({
            id: opId,
            operation: {
              operation: BLOCKS_OPERATIONS.BATCH_ADD_BLOCKS,
              target: OPERATION_TARGETS.BLOCKS,
              payload: {
                blocks: blocksToAdd,
                edges: edgeSnapshots || [],
                loops: {},
                parallels: {},
                subBlockValues: subBlockValues || {},
              },
            },
            workflowId: activeWorkflowId,
            userId,
          })

          useWorkflowStore
            .getState()
            .batchAddBlocks(blocksToAdd, edgeSnapshots || [], subBlockValues || {})
          break
        }
        case UNDO_REDO_OPERATIONS.BATCH_REMOVE_EDGES: {
          // Undo batch-add-edges: inverse is batch-remove-edges, so remove the edges
          const batchRemoveInverse = entry.inverse as BatchRemoveEdgesOperation
          const { edgeSnapshots } = batchRemoveInverse.data

          const edgesToRemove = edgeSnapshots
            .filter((e) => useWorkflowStore.getState().edges.find((edge) => edge.id === e.id))
            .map((e) => e.id)

          if (edgesToRemove.length > 0) {
            addToQueue({
              id: opId,
              operation: {
                operation: EDGES_OPERATIONS.BATCH_REMOVE_EDGES,
                target: OPERATION_TARGETS.EDGES,
                payload: { ids: edgesToRemove },
              },
              workflowId: activeWorkflowId,
              userId,
            })
            useWorkflowStore.getState().batchRemoveEdges(edgesToRemove)
          }
          logger.debug('Undid batch-add-edges', { edgeCount: edgesToRemove.length })
          break
        }
        case UNDO_REDO_OPERATIONS.BATCH_ADD_EDGES: {
          // Undo batch-remove-edges: inverse is batch-add-edges, so add edges back
          const batchAddInverse = entry.inverse as BatchAddEdgesOperation
          const { edgeSnapshots } = batchAddInverse.data

          const edgesToAdd = edgeSnapshots.filter(
            (e) => !useWorkflowStore.getState().edges.find((edge) => edge.id === e.id)
          )

          if (edgesToAdd.length > 0) {
            addToQueue({
              id: opId,
              operation: {
                operation: EDGES_OPERATIONS.BATCH_ADD_EDGES,
                target: OPERATION_TARGETS.EDGES,
                payload: { edges: edgesToAdd },
              },
              workflowId: activeWorkflowId,
              userId,
            })
            useWorkflowStore.getState().batchAddEdges(edgesToAdd)
          }
          logger.debug('Undid batch-remove-edges', { edgeCount: edgesToAdd.length })
          break
        }
        case UNDO_REDO_OPERATIONS.BATCH_MOVE_BLOCKS: {
          const batchMoveOp = entry.inverse as BatchMoveBlocksOperation
          const currentBlocks = useWorkflowStore.getState().blocks
          const positionUpdates: Array<{ id: string; position: { x: number; y: number } }> = []

          for (const move of batchMoveOp.data.moves) {
            if (currentBlocks[move.blockId]) {
              positionUpdates.push({
                id: move.blockId,
                position: { x: move.after.x, y: move.after.y },
              })
            }
          }

          if (positionUpdates.length > 0) {
            useWorkflowStore.getState().batchUpdatePositions(positionUpdates)
            addToQueue({
              id: opId,
              operation: {
                operation: BLOCKS_OPERATIONS.BATCH_UPDATE_POSITIONS,
                target: OPERATION_TARGETS.BLOCKS,
                payload: { updates: positionUpdates },
              },
              workflowId: activeWorkflowId,
              userId,
            })
          }
          break
        }
        case UNDO_REDO_OPERATIONS.UPDATE_PARENT: {
          const updateOp = entry.inverse as UpdateParentOperation
          const { blockId, newParentId, newPosition, affectedEdges } = updateOp.data

          if (useWorkflowStore.getState().blocks[blockId]) {
            if (newParentId && affectedEdges && affectedEdges.length > 0) {
              const edgesToAdd = affectedEdges.filter(
                (e) => !useWorkflowStore.getState().edges.find((edge) => edge.id === e.id)
              )
              if (edgesToAdd.length > 0) {
                addToQueue({
                  id: crypto.randomUUID(),
                  operation: {
                    operation: EDGES_OPERATIONS.BATCH_ADD_EDGES,
                    target: OPERATION_TARGETS.EDGES,
                    payload: { edges: edgesToAdd },
                  },
                  workflowId: activeWorkflowId,
                  userId,
                })
                useWorkflowStore.getState().batchAddEdges(edgesToAdd)
              }
            }

            addToQueue({
              id: crypto.randomUUID(),
              operation: {
                operation: BLOCK_OPERATIONS.UPDATE_POSITION,
                target: OPERATION_TARGETS.BLOCK,
                payload: {
                  id: blockId,
                  position: newPosition,
                  commit: true,
                  isUndo: true,
                  originalOpId: entry.id,
                },
              },
              workflowId: activeWorkflowId,
              userId,
            })

            // Send parent update to server
            addToQueue({
              id: opId,
              operation: {
                operation: BLOCK_OPERATIONS.UPDATE_PARENT,
                target: OPERATION_TARGETS.BLOCK,
                payload: {
                  id: blockId,
                  parentId: newParentId || '',
                  extent: 'parent',
                  isUndo: true,
                  originalOpId: entry.id,
                },
              },
              workflowId: activeWorkflowId,
              userId,
            })

            // Update position and parent locally using batch method
            useWorkflowStore.getState().batchUpdateBlocksWithParent([
              {
                id: blockId,
                position: newPosition,
                parentId: newParentId,
              },
            ])

            // If we're removing FROM a subflow (undo of add to subflow), remove edges after
            if (!newParentId && affectedEdges && affectedEdges.length > 0) {
              const edgeIdsToRemove = affectedEdges
                .filter((edge) => useWorkflowStore.getState().edges.find((e) => e.id === edge.id))
                .map((edge) => edge.id)
              if (edgeIdsToRemove.length > 0) {
                useWorkflowStore.getState().batchRemoveEdges(edgeIdsToRemove)
                edgeIdsToRemove.forEach((edgeId) => {
                  addToQueue({
                    id: crypto.randomUUID(),
                    operation: {
                      operation: EDGE_OPERATIONS.REMOVE,
                      target: OPERATION_TARGETS.EDGE,
                      payload: { id: edgeId, isUndo: true },
                    },
                    workflowId: activeWorkflowId,
                    userId,
                  })
                })
              }
            }
          } else {
            logger.debug('Undo update-parent skipped; block missing', { blockId })
          }
          break
        }
        case UNDO_REDO_OPERATIONS.BATCH_UPDATE_PARENT: {
          const batchUpdateOp = entry.inverse as BatchUpdateParentOperation
          const { updates } = batchUpdateOp.data

          const validUpdates = updates.filter((u) => useWorkflowStore.getState().blocks[u.blockId])
          if (validUpdates.length === 0) {
            logger.debug('Undo batch-update-parent skipped; no blocks exist')
            break
          }

          // Collect all edge operations first
          const allEdgesToAdd: Edge[] = []
          const allEdgeIdsToRemove: string[] = []

          for (const update of validUpdates) {
            const { newParentId, affectedEdges } = update

            // Moving OUT of subflow (undoing insert) → restore edges first
            if (!newParentId && affectedEdges && affectedEdges.length > 0) {
              const edgesToAdd = affectedEdges.filter(
                (e) => !useWorkflowStore.getState().edges.find((edge) => edge.id === e.id)
              )
              allEdgesToAdd.push(...edgesToAdd)
            }

            // Moving INTO subflow (undoing removal) → remove edges first
            if (newParentId && affectedEdges && affectedEdges.length > 0) {
              const edgeIds = affectedEdges
                .filter((edge) => useWorkflowStore.getState().edges.find((e) => e.id === edge.id))
                .map((edge) => edge.id)
              allEdgeIdsToRemove.push(...edgeIds)
            }
          }

          // Apply edge operations in batch
          if (allEdgesToAdd.length > 0) {
            addToQueue({
              id: crypto.randomUUID(),
              operation: {
                operation: EDGES_OPERATIONS.BATCH_ADD_EDGES,
                target: OPERATION_TARGETS.EDGES,
                payload: { edges: allEdgesToAdd },
              },
              workflowId: activeWorkflowId,
              userId,
            })
            useWorkflowStore.getState().batchAddEdges(allEdgesToAdd)
          }

          if (allEdgeIdsToRemove.length > 0) {
            useWorkflowStore.getState().batchRemoveEdges(allEdgeIdsToRemove)
            addToQueue({
              id: crypto.randomUUID(),
              operation: {
                operation: EDGES_OPERATIONS.BATCH_REMOVE_EDGES,
                target: OPERATION_TARGETS.EDGES,
                payload: { edgeIds: allEdgeIdsToRemove },
              },
              workflowId: activeWorkflowId,
              userId,
            })
          }

          // Update positions and parents locally in batch
          const blockUpdates = validUpdates.map((update) => ({
            id: update.blockId,
            position: update.newPosition,
            parentId: update.newParentId,
          }))
          useWorkflowStore.getState().batchUpdateBlocksWithParent(blockUpdates)

          // Send batch update to server
          addToQueue({
            id: opId,
            operation: {
              operation: BLOCKS_OPERATIONS.BATCH_UPDATE_PARENT,
              target: OPERATION_TARGETS.BLOCKS,
              payload: {
                updates: validUpdates.map((u) => ({
                  id: u.blockId,
                  parentId: u.newParentId || '',
                  position: u.newPosition,
                })),
              },
            },
            workflowId: activeWorkflowId,
            userId,
          })

          logger.debug('Undid batch-update-parent', { updateCount: validUpdates.length })
          break
        }
        case UNDO_REDO_OPERATIONS.BATCH_TOGGLE_ENABLED: {
          const toggleOp = entry.inverse as BatchToggleEnabledOperation
          const { blockIds, previousStates } = toggleOp.data

          // Restore all blocks in previousStates (includes children of containers)
          const allBlockIds = Object.keys(previousStates)
          const validBlockIds = allBlockIds.filter((id) => useWorkflowStore.getState().blocks[id])
          if (validBlockIds.length === 0) {
            logger.debug('Undo batch-toggle-enabled skipped; no blocks exist')
            break
          }

          addToQueue({
            id: opId,
            operation: {
              operation: BLOCKS_OPERATIONS.BATCH_TOGGLE_ENABLED,
              target: OPERATION_TARGETS.BLOCKS,
              payload: { blockIds, previousStates },
            },
            workflowId: activeWorkflowId,
            userId,
          })

          // Use setBlockEnabled to directly restore to previous state
          // This restores all affected blocks including children of containers
          validBlockIds.forEach((blockId) => {
            useWorkflowStore.getState().setBlockEnabled(blockId, previousStates[blockId])
          })
          break
        }
        case UNDO_REDO_OPERATIONS.BATCH_TOGGLE_HANDLES: {
          const toggleOp = entry.inverse as BatchToggleHandlesOperation
          const { blockIds, previousStates } = toggleOp.data

          const validBlockIds = blockIds.filter((id) => useWorkflowStore.getState().blocks[id])
          if (validBlockIds.length === 0) {
            logger.debug('Undo batch-toggle-handles skipped; no blocks exist')
            break
          }

          addToQueue({
            id: opId,
            operation: {
              operation: BLOCKS_OPERATIONS.BATCH_TOGGLE_HANDLES,
              target: OPERATION_TARGETS.BLOCKS,
              payload: { blockIds: validBlockIds, previousStates },
            },
            workflowId: activeWorkflowId,
            userId,
          })

          // Use setBlockHandles to directly restore to previous state
          // This is more robust than conditional toggle in collaborative scenarios
          validBlockIds.forEach((blockId) => {
            useWorkflowStore.getState().setBlockHandles(blockId, previousStates[blockId])
          })
          break
        }
        case UNDO_REDO_OPERATIONS.BATCH_TOGGLE_LOCKED: {
          const toggleOp = entry.inverse as BatchToggleLockedOperation
          const { blockIds, previousStates } = toggleOp.data

          // Restore all blocks in previousStates (includes children of containers)
          const allBlockIds = Object.keys(previousStates)
          const validBlockIds = allBlockIds.filter((id) => useWorkflowStore.getState().blocks[id])
          if (validBlockIds.length === 0) {
            logger.debug('Undo batch-toggle-locked skipped; no blocks exist')
            break
          }

          addToQueue({
            id: opId,
            operation: {
              operation: BLOCKS_OPERATIONS.BATCH_TOGGLE_LOCKED,
              target: OPERATION_TARGETS.BLOCKS,
              payload: { blockIds, previousStates },
            },
            workflowId: activeWorkflowId,
            userId,
          })

          // Use setBlockLocked to directly restore to previous state
          // This restores all affected blocks including children of containers
          validBlockIds.forEach((blockId) => {
            useWorkflowStore.getState().setBlockLocked(blockId, previousStates[blockId])
          })
          break
        }
        case UNDO_REDO_OPERATIONS.APPLY_DIFF: {
          const applyDiffInverse = entry.inverse as any
          const { baselineSnapshot } = applyDiffInverse.data

          logger.info('Undoing apply-diff operation', {
            hasBaseline: !!baselineSnapshot,
            baselineBlockCount: Object.keys(baselineSnapshot?.blocks || {}).length,
            activeWorkflowId,
          })

          const { useWorkflowDiffStore } = await import('@/stores/workflow-diff/store')
          const { useWorkflowStore } = await import('@/stores/workflows/workflow/store')
          const { useSubBlockStore } = await import('@/stores/workflows/subblock/store')

          // Set flag to skip recording during this operation

          ;(window as any).__skipDiffRecording = true
          try {
            // Restore baseline state and broadcast to everyone
            if (baselineSnapshot && activeWorkflowId) {
              logger.info('Restoring baseline state', {
                blockCount: Object.keys(baselineSnapshot.blocks || {}).length,
              })

              useWorkflowStore.getState().replaceWorkflowState(baselineSnapshot)

              // Extract and set subblock values
              const subBlockValues: Record<string, Record<string, any>> = {}
              Object.entries(baselineSnapshot.blocks || {}).forEach(
                ([blockId, block]: [string, any]) => {
                  subBlockValues[blockId] = {}
                  Object.entries(block.subBlocks || {}).forEach(
                    ([subBlockId, subBlock]: [string, any]) => {
                      subBlockValues[blockId][subBlockId] = subBlock.value
                    }
                  )
                }
              )
              useSubBlockStore.getState().setWorkflowValues(activeWorkflowId, subBlockValues)

              // Broadcast state change to other users
              logger.info('Broadcasting baseline state to other users')
              await enqueueReplaceWorkflowState({
                workflowId: activeWorkflowId,
                state: baselineSnapshot,
                operationId: opId,
              })
            }

            // Clear diff state (local UI only)
            logger.info('Clearing diff UI state')
            useWorkflowDiffStore.getState().clearDiff({ restoreBaseline: false })
          } finally {
            ;(window as any).__skipDiffRecording = false
          }

          logger.info('Undid apply-diff operation successfully')
          break
        }
        case UNDO_REDO_OPERATIONS.ACCEPT_DIFF: {
          // Undo accept-diff means restoring diff view with markers
          const acceptDiffInverse = entry.inverse as any
          const acceptDiffOp = entry.operation as any
          const { beforeAccept, diffAnalysis } = acceptDiffInverse.data
          const { useWorkflowDiffStore } = await import('@/stores/workflow-diff/store')
          const diffStore = useWorkflowDiffStore.getState()

          // Restore the workflow state with diff markers
          const { useWorkflowStore } = await import('@/stores/workflows/workflow/store')
          const { useSubBlockStore } = await import('@/stores/workflows/subblock/store')

          // Set flag to skip recording during this operation

          ;(window as any).__skipDiffRecording = true
          try {
            // Apply the before-accept state (with markers for this user)
            useWorkflowStore.getState().replaceWorkflowState(beforeAccept)

            // Extract and set subblock values
            const subBlockValues: Record<string, Record<string, any>> = {}
            Object.entries(beforeAccept.blocks || {}).forEach(([blockId, block]: [string, any]) => {
              subBlockValues[blockId] = {}
              Object.entries(block.subBlocks || {}).forEach(
                ([subBlockId, subBlock]: [string, any]) => {
                  subBlockValues[blockId][subBlockId] = subBlock.value
                }
              )
            })
            useSubBlockStore.getState().setWorkflowValues(activeWorkflowId, subBlockValues)

            // Broadcast clean state to other users (without markers)
            const { stripWorkflowDiffMarkers } = await import('@/lib/workflows/diff')
            const cleanState = stripWorkflowDiffMarkers(beforeAccept)
            await enqueueReplaceWorkflowState({
              workflowId: activeWorkflowId,
              state: cleanState,
              operationId: opId,
            })

            // Get baseline from the original apply-diff operation
            const { baselineSnapshot: originalBaseline } = acceptDiffOp.data

            // Restore diff state with baseline (local UI only)
            diffStore._batchedStateUpdate({
              hasActiveDiff: true,
              isShowingDiff: true,
              isDiffReady: true,
              baselineWorkflow: originalBaseline || null,
              baselineWorkflowId: activeWorkflowId,
              diffAnalysis: diffAnalysis,
            })
          } finally {
            ;(window as any).__skipDiffRecording = false
          }

          logger.info('Undid accept-diff operation - restored diff view')
          break
        }
        case UNDO_REDO_OPERATIONS.REJECT_DIFF: {
          // Undo reject-diff means restoring diff view with markers
          const rejectDiffInverse = entry.inverse as any
          const { beforeReject, diffAnalysis, baselineSnapshot } = rejectDiffInverse.data
          const { useWorkflowDiffStore } = await import('@/stores/workflow-diff/store')
          const { useWorkflowStore } = await import('@/stores/workflows/workflow/store')
          const { useSubBlockStore } = await import('@/stores/workflows/subblock/store')

          ;(window as any).__skipDiffRecording = true
          try {
            // Apply the before-reject state (with markers for this user)
            useWorkflowStore.getState().replaceWorkflowState(beforeReject)

            // Extract and set subblock values
            const subBlockValues: Record<string, Record<string, any>> = {}
            Object.entries(beforeReject.blocks || {}).forEach(([blockId, block]: [string, any]) => {
              subBlockValues[blockId] = {}
              Object.entries(block.subBlocks || {}).forEach(
                ([subBlockId, subBlock]: [string, any]) => {
                  subBlockValues[blockId][subBlockId] = subBlock.value
                }
              )
            })
            useSubBlockStore.getState().setWorkflowValues(activeWorkflowId, subBlockValues)

            // Broadcast clean state to other users (without markers)
            const { stripWorkflowDiffMarkers } = await import('@/lib/workflows/diff')
            const cleanState = stripWorkflowDiffMarkers(beforeReject)
            await enqueueReplaceWorkflowState({
              workflowId: activeWorkflowId,
              state: cleanState,
              operationId: opId,
            })

            // Restore diff state with baseline (local UI only)
            const diffStore = useWorkflowDiffStore.getState()
            diffStore._batchedStateUpdate({
              hasActiveDiff: true,
              isShowingDiff: true,
              isDiffReady: true,
              baselineWorkflow: baselineSnapshot || null,
              baselineWorkflowId: activeWorkflowId,
              diffAnalysis: diffAnalysis,
            })
          } finally {
            ;(window as any).__skipDiffRecording = false
          }

          logger.info('Undid reject-diff operation - restored diff view')
          break
        }
      }

      logger.info('Undo operation', { type: entry.operation.type, workflowId: activeWorkflowId })
    })
  }, [activeWorkflowId, userId, addToQueue])

  const redo = useCallback(async () => {
    if (!activeWorkflowId || !userId) return

    await runWithUndoRedoRecordingSuspended(async () => {
      const entry = useUndoRedoStore.getState().redo(activeWorkflowId, userId)
      if (!entry) {
        logger.debug('No operations to redo')
        return
      }

      const opId = crypto.randomUUID()

      switch (entry.operation.type) {
        case UNDO_REDO_OPERATIONS.BATCH_ADD_BLOCKS: {
          const batchOp = entry.operation as BatchAddBlocksOperation
          const { blockSnapshots, edgeSnapshots, subBlockValues } = batchOp.data

          const blocksToAdd = blockSnapshots.filter(
            (b) => !useWorkflowStore.getState().blocks[b.id]
          )
          if (blocksToAdd.length === 0) {
            logger.debug('Redo batch-add-blocks skipped; all blocks exist')
            break
          }

          addToQueue({
            id: opId,
            operation: {
              operation: BLOCKS_OPERATIONS.BATCH_ADD_BLOCKS,
              target: OPERATION_TARGETS.BLOCKS,
              payload: {
                blocks: blocksToAdd,
                edges: edgeSnapshots || [],
                loops: {},
                parallels: {},
                subBlockValues: subBlockValues || {},
              },
            },
            workflowId: activeWorkflowId,
            userId,
          })

          useWorkflowStore
            .getState()
            .batchAddBlocks(blocksToAdd, edgeSnapshots || [], subBlockValues || {})
          break
        }
        case UNDO_REDO_OPERATIONS.BATCH_REMOVE_BLOCKS: {
          const batchOp = entry.operation as BatchRemoveBlocksOperation
          const { blockSnapshots } = batchOp.data
          const blockIds = blockSnapshots.map((b) => b.id)

          const existingBlockIds = blockIds.filter((id) => useWorkflowStore.getState().blocks[id])
          if (existingBlockIds.length === 0) {
            logger.debug('Redo batch-remove-blocks skipped; no blocks exist')
            break
          }

          const latestEdges = captureLatestEdges(
            useWorkflowStore.getState().edges,
            existingBlockIds
          )
          batchOp.data.edgeSnapshots = latestEdges

          const latestSubBlockValues = captureLatestSubBlockValues(
            useWorkflowStore.getState().blocks,
            activeWorkflowId,
            existingBlockIds
          )
          batchOp.data.subBlockValues = latestSubBlockValues
          ;(entry.inverse as BatchAddBlocksOperation).data.subBlockValues = latestSubBlockValues

          addToQueue({
            id: opId,
            operation: {
              operation: BLOCKS_OPERATIONS.BATCH_REMOVE_BLOCKS,
              target: OPERATION_TARGETS.BLOCKS,
              payload: { ids: existingBlockIds },
            },
            workflowId: activeWorkflowId,
            userId,
          })

          useWorkflowStore.getState().batchRemoveBlocks(existingBlockIds)
          break
        }
        case UNDO_REDO_OPERATIONS.BATCH_REMOVE_EDGES: {
          // Redo batch-remove-edges: remove all edges again
          const batchRemoveOp = entry.operation as BatchRemoveEdgesOperation
          const { edgeSnapshots } = batchRemoveOp.data

          const edgesToRemove = edgeSnapshots
            .filter((e) => useWorkflowStore.getState().edges.find((edge) => edge.id === e.id))
            .map((e) => e.id)

          if (edgesToRemove.length > 0) {
            addToQueue({
              id: opId,
              operation: {
                operation: EDGES_OPERATIONS.BATCH_REMOVE_EDGES,
                target: OPERATION_TARGETS.EDGES,
                payload: { ids: edgesToRemove },
              },
              workflowId: activeWorkflowId,
              userId,
            })
            useWorkflowStore.getState().batchRemoveEdges(edgesToRemove)
          }

          logger.debug('Redid batch-remove-edges', { edgeCount: edgesToRemove.length })
          break
        }
        case UNDO_REDO_OPERATIONS.BATCH_ADD_EDGES: {
          // Redo batch-add-edges: add all edges again
          const batchAddOp = entry.operation as BatchAddEdgesOperation
          const { edgeSnapshots } = batchAddOp.data

          const edgesToAdd = edgeSnapshots.filter(
            (e) => !useWorkflowStore.getState().edges.find((edge) => edge.id === e.id)
          )

          if (edgesToAdd.length > 0) {
            addToQueue({
              id: opId,
              operation: {
                operation: EDGES_OPERATIONS.BATCH_ADD_EDGES,
                target: OPERATION_TARGETS.EDGES,
                payload: { edges: edgesToAdd },
              },
              workflowId: activeWorkflowId,
              userId,
            })
            useWorkflowStore.getState().batchAddEdges(edgesToAdd)
          }

          logger.debug('Redid batch-add-edges', { edgeCount: edgesToAdd.length })
          break
        }
        case UNDO_REDO_OPERATIONS.BATCH_MOVE_BLOCKS: {
          const batchMoveOp = entry.operation as BatchMoveBlocksOperation
          const currentBlocks = useWorkflowStore.getState().blocks
          const positionUpdates: Array<{ id: string; position: { x: number; y: number } }> = []

          for (const move of batchMoveOp.data.moves) {
            if (currentBlocks[move.blockId]) {
              positionUpdates.push({
                id: move.blockId,
                position: { x: move.after.x, y: move.after.y },
              })
            }
          }

          if (positionUpdates.length > 0) {
            useWorkflowStore.getState().batchUpdatePositions(positionUpdates)
            addToQueue({
              id: opId,
              operation: {
                operation: BLOCKS_OPERATIONS.BATCH_UPDATE_POSITIONS,
                target: OPERATION_TARGETS.BLOCKS,
                payload: { updates: positionUpdates },
              },
              workflowId: activeWorkflowId,
              userId,
            })
          }
          break
        }
        case UNDO_REDO_OPERATIONS.UPDATE_PARENT: {
          // Redo parent update means applying the new parent and position
          const updateOp = entry.operation as UpdateParentOperation
          const { blockId, newParentId, newPosition, affectedEdges } = updateOp.data

          if (useWorkflowStore.getState().blocks[blockId]) {
            // If we're removing FROM a subflow, remove edges first
            if (!newParentId && affectedEdges && affectedEdges.length > 0) {
              const edgeIdsToRemove = affectedEdges
                .filter((edge) => useWorkflowStore.getState().edges.find((e) => e.id === edge.id))
                .map((edge) => edge.id)
              if (edgeIdsToRemove.length > 0) {
                useWorkflowStore.getState().batchRemoveEdges(edgeIdsToRemove)
                edgeIdsToRemove.forEach((edgeId) => {
                  addToQueue({
                    id: crypto.randomUUID(),
                    operation: {
                      operation: EDGE_OPERATIONS.REMOVE,
                      target: OPERATION_TARGETS.EDGE,
                      payload: { id: edgeId, isRedo: true },
                    },
                    workflowId: activeWorkflowId,
                    userId,
                  })
                })
              }
            }

            // Send position update to server
            addToQueue({
              id: crypto.randomUUID(),
              operation: {
                operation: BLOCK_OPERATIONS.UPDATE_POSITION,
                target: OPERATION_TARGETS.BLOCK,
                payload: {
                  id: blockId,
                  position: newPosition,
                  commit: true,
                  isRedo: true,
                  originalOpId: entry.id,
                },
              },
              workflowId: activeWorkflowId,
              userId,
            })

            // Send parent update to server
            addToQueue({
              id: opId,
              operation: {
                operation: BLOCK_OPERATIONS.UPDATE_PARENT,
                target: OPERATION_TARGETS.BLOCK,
                payload: {
                  id: blockId,
                  parentId: newParentId || '',
                  extent: 'parent',
                  isRedo: true,
                  originalOpId: entry.id,
                },
              },
              workflowId: activeWorkflowId,
              userId,
            })

            // Update position and parent locally using batch method
            useWorkflowStore.getState().batchUpdateBlocksWithParent([
              {
                id: blockId,
                position: newPosition,
                parentId: newParentId,
              },
            ])

            // If we're adding TO a subflow, restore edges after
            if (newParentId && affectedEdges && affectedEdges.length > 0) {
              const edgesToAdd = affectedEdges.filter(
                (e) => !useWorkflowStore.getState().edges.find((edge) => edge.id === e.id)
              )
              if (edgesToAdd.length > 0) {
                addToQueue({
                  id: crypto.randomUUID(),
                  operation: {
                    operation: EDGES_OPERATIONS.BATCH_ADD_EDGES,
                    target: OPERATION_TARGETS.EDGES,
                    payload: { edges: edgesToAdd },
                  },
                  workflowId: activeWorkflowId,
                  userId,
                })
                useWorkflowStore.getState().batchAddEdges(edgesToAdd)
              }
            }
          } else {
            logger.debug('Redo update-parent skipped; block missing', { blockId })
          }
          break
        }
        case UNDO_REDO_OPERATIONS.BATCH_UPDATE_PARENT: {
          const batchUpdateOp = entry.operation as BatchUpdateParentOperation
          const { updates } = batchUpdateOp.data

          const validUpdates = updates.filter((u) => useWorkflowStore.getState().blocks[u.blockId])
          if (validUpdates.length === 0) {
            logger.debug('Redo batch-update-parent skipped; no blocks exist')
            break
          }

          // Collect all edge operations first
          const allEdgesToAdd: Edge[] = []
          const allEdgeIdsToRemove: string[] = []

          for (const update of validUpdates) {
            const { newParentId, affectedEdges } = update

            // Moving INTO subflow (redoing insert) → remove edges first
            if (newParentId && affectedEdges && affectedEdges.length > 0) {
              const edgeIds = affectedEdges
                .filter((edge) => useWorkflowStore.getState().edges.find((e) => e.id === edge.id))
                .map((edge) => edge.id)
              allEdgeIdsToRemove.push(...edgeIds)
            }

            // Moving OUT of subflow (redoing removal) → restore edges after
            if (!newParentId && affectedEdges && affectedEdges.length > 0) {
              const edgesToAdd = affectedEdges.filter(
                (e) => !useWorkflowStore.getState().edges.find((edge) => edge.id === e.id)
              )
              allEdgesToAdd.push(...edgesToAdd)
            }
          }

          // Apply edge removals in batch first
          if (allEdgeIdsToRemove.length > 0) {
            useWorkflowStore.getState().batchRemoveEdges(allEdgeIdsToRemove)
            addToQueue({
              id: crypto.randomUUID(),
              operation: {
                operation: EDGES_OPERATIONS.BATCH_REMOVE_EDGES,
                target: OPERATION_TARGETS.EDGES,
                payload: { edgeIds: allEdgeIdsToRemove },
              },
              workflowId: activeWorkflowId,
              userId,
            })
          }

          // Update positions and parents locally in batch
          const blockUpdates = validUpdates.map((update) => ({
            id: update.blockId,
            position: update.newPosition,
            parentId: update.newParentId,
          }))
          useWorkflowStore.getState().batchUpdateBlocksWithParent(blockUpdates)

          // Apply edge additions in batch after
          if (allEdgesToAdd.length > 0) {
            addToQueue({
              id: crypto.randomUUID(),
              operation: {
                operation: EDGES_OPERATIONS.BATCH_ADD_EDGES,
                target: OPERATION_TARGETS.EDGES,
                payload: { edges: allEdgesToAdd },
              },
              workflowId: activeWorkflowId,
              userId,
            })
            useWorkflowStore.getState().batchAddEdges(allEdgesToAdd)
          }

          // Send batch update to server
          addToQueue({
            id: opId,
            operation: {
              operation: BLOCKS_OPERATIONS.BATCH_UPDATE_PARENT,
              target: OPERATION_TARGETS.BLOCKS,
              payload: {
                updates: validUpdates.map((u) => ({
                  id: u.blockId,
                  parentId: u.newParentId || '',
                  position: u.newPosition,
                })),
              },
            },
            workflowId: activeWorkflowId,
            userId,
          })

          logger.debug('Redid batch-update-parent', { updateCount: validUpdates.length })
          break
        }
        case UNDO_REDO_OPERATIONS.BATCH_TOGGLE_ENABLED: {
          const toggleOp = entry.operation as BatchToggleEnabledOperation
          const { blockIds, previousStates } = toggleOp.data

          // Process all blocks in previousStates (includes children of containers)
          const allBlockIds = Object.keys(previousStates)
          const validBlockIds = allBlockIds.filter((id) => useWorkflowStore.getState().blocks[id])
          if (validBlockIds.length === 0) {
            logger.debug('Redo batch-toggle-enabled skipped; no blocks exist')
            break
          }

          addToQueue({
            id: opId,
            operation: {
              operation: BLOCKS_OPERATIONS.BATCH_TOGGLE_ENABLED,
              target: OPERATION_TARGETS.BLOCKS,
              payload: { blockIds, previousStates },
            },
            workflowId: activeWorkflowId,
            userId,
          })

          // Compute target state the same way batchToggleEnabled does:
          // use !firstBlock.enabled, where firstBlock is blockIds[0]
          const firstBlockId = blockIds[0]
          const targetEnabled = !previousStates[firstBlockId]
          validBlockIds.forEach((blockId) => {
            useWorkflowStore.getState().setBlockEnabled(blockId, targetEnabled)
          })
          break
        }
        case UNDO_REDO_OPERATIONS.BATCH_TOGGLE_HANDLES: {
          const toggleOp = entry.operation as BatchToggleHandlesOperation
          const { blockIds, previousStates } = toggleOp.data

          const validBlockIds = blockIds.filter((id) => useWorkflowStore.getState().blocks[id])
          if (validBlockIds.length === 0) {
            logger.debug('Redo batch-toggle-handles skipped; no blocks exist')
            break
          }

          addToQueue({
            id: opId,
            operation: {
              operation: BLOCKS_OPERATIONS.BATCH_TOGGLE_HANDLES,
              target: OPERATION_TARGETS.BLOCKS,
              payload: { blockIds: validBlockIds, previousStates },
            },
            workflowId: activeWorkflowId,
            userId,
          })

          // Use setBlockHandles to directly set to toggled state
          // Redo sets to !previousStates (the state after the original toggle)
          validBlockIds.forEach((blockId) => {
            useWorkflowStore.getState().setBlockHandles(blockId, !previousStates[blockId])
          })
          break
        }
        case UNDO_REDO_OPERATIONS.BATCH_TOGGLE_LOCKED: {
          const toggleOp = entry.operation as BatchToggleLockedOperation
          const { blockIds, previousStates } = toggleOp.data

          // Process all blocks in previousStates (includes children of containers)
          const allBlockIds = Object.keys(previousStates)
          const validBlockIds = allBlockIds.filter((id) => useWorkflowStore.getState().blocks[id])
          if (validBlockIds.length === 0) {
            logger.debug('Redo batch-toggle-locked skipped; no blocks exist')
            break
          }

          addToQueue({
            id: opId,
            operation: {
              operation: BLOCKS_OPERATIONS.BATCH_TOGGLE_LOCKED,
              target: OPERATION_TARGETS.BLOCKS,
              payload: { blockIds, previousStates },
            },
            workflowId: activeWorkflowId,
            userId,
          })

          // Compute target state the same way batchToggleLocked does:
          // use !firstBlock.locked, where firstBlock is blockIds[0]
          const firstBlockId = blockIds[0]
          const targetLocked = !previousStates[firstBlockId]
          validBlockIds.forEach((blockId) => {
            useWorkflowStore.getState().setBlockLocked(blockId, targetLocked)
          })
          break
        }
        case UNDO_REDO_OPERATIONS.APPLY_DIFF: {
          // Redo apply-diff means re-applying the proposed state with diff markers
          const applyDiffOp = entry.operation as any
          const { proposedState, diffAnalysis, baselineSnapshot } = applyDiffOp.data
          const { useWorkflowDiffStore } = await import('@/stores/workflow-diff/store')
          const { useWorkflowStore } = await import('@/stores/workflows/workflow/store')
          const { useSubBlockStore } = await import('@/stores/workflows/subblock/store')

          // Set flag to skip recording during this operation

          ;(window as any).__skipDiffRecording = true
          try {
            // Manually apply the proposed state and set up diff store (similar to setProposedChanges but with original baseline)
            const diffStore = useWorkflowDiffStore.getState()

            // Apply proposed state WITH markers locally (for this user's diff UI)
            useWorkflowStore.getState().replaceWorkflowState(proposedState)

            // Extract and set subblock values
            const subBlockValues: Record<string, Record<string, any>> = {}
            Object.entries(proposedState.blocks || {}).forEach(
              ([blockId, block]: [string, any]) => {
                subBlockValues[blockId] = {}
                Object.entries(block.subBlocks || {}).forEach(
                  ([subBlockId, subBlock]: [string, any]) => {
                    subBlockValues[blockId][subBlockId] = subBlock.value
                  }
                )
              }
            )
            useSubBlockStore.getState().setWorkflowValues(activeWorkflowId, subBlockValues)

            // Broadcast clean state to other users (without markers)
            const { stripWorkflowDiffMarkers } = await import('@/lib/workflows/diff')
            const cleanState = stripWorkflowDiffMarkers(proposedState)
            await enqueueReplaceWorkflowState({
              workflowId: activeWorkflowId,
              state: cleanState,
              operationId: opId,
            })

            // Restore diff state with original baseline (local UI only)
            diffStore._batchedStateUpdate({
              hasActiveDiff: true,
              isShowingDiff: true,
              isDiffReady: true,
              baselineWorkflow: baselineSnapshot,
              baselineWorkflowId: activeWorkflowId,
              diffAnalysis: diffAnalysis,
            })
          } finally {
            ;(window as any).__skipDiffRecording = false
          }

          logger.info('Redid apply-diff operation')
          break
        }
        case UNDO_REDO_OPERATIONS.ACCEPT_DIFF: {
          // Redo accept-diff means re-accepting (stripping markers)
          const acceptDiffOp = entry.operation as any
          const { afterAccept } = acceptDiffOp.data
          const { useWorkflowDiffStore } = await import('@/stores/workflow-diff/store')
          const { useWorkflowStore } = await import('@/stores/workflows/workflow/store')
          const { useSubBlockStore } = await import('@/stores/workflows/subblock/store')

          // Set flag to skip recording during this operation

          ;(window as any).__skipDiffRecording = true
          try {
            // Clear diff state FIRST to prevent flash of colors (local UI only)
            // Use setState directly to ensure synchronous clearing
            useWorkflowDiffStore.setState({
              hasActiveDiff: false,
              isShowingDiff: false,
              isDiffReady: false,
              baselineWorkflow: null,
              baselineWorkflowId: null,
              diffAnalysis: null,
              diffMetadata: null,
              diffError: null,
              _triggerMessageId: null,
            })

            // Apply the after-accept state (without markers) and broadcast
            useWorkflowStore.getState().replaceWorkflowState(afterAccept)

            // Extract and set subblock values
            const subBlockValues: Record<string, Record<string, any>> = {}
            Object.entries(afterAccept.blocks || {}).forEach(([blockId, block]: [string, any]) => {
              subBlockValues[blockId] = {}
              Object.entries(block.subBlocks || {}).forEach(
                ([subBlockId, subBlock]: [string, any]) => {
                  subBlockValues[blockId][subBlockId] = subBlock.value
                }
              )
            })
            useSubBlockStore.getState().setWorkflowValues(activeWorkflowId, subBlockValues)

            // Broadcast state change to other users
            await enqueueReplaceWorkflowState({
              workflowId: activeWorkflowId,
              state: afterAccept,
              operationId: opId,
            })
          } finally {
            ;(window as any).__skipDiffRecording = false
          }

          logger.info('Redid accept-diff operation - cleared diff view')
          break
        }
        case UNDO_REDO_OPERATIONS.REJECT_DIFF: {
          // Redo reject-diff means re-rejecting (restoring baseline, clearing diff)
          const rejectDiffOp = entry.operation as any
          const { afterReject } = rejectDiffOp.data
          const { useWorkflowDiffStore } = await import('@/stores/workflow-diff/store')
          const { useWorkflowStore } = await import('@/stores/workflows/workflow/store')
          const { useSubBlockStore } = await import('@/stores/workflows/subblock/store')

          ;(window as any).__skipDiffRecording = true
          try {
            // Clear diff state FIRST to prevent flash of colors (local UI only)
            // Use setState directly to ensure synchronous clearing
            useWorkflowDiffStore.setState({
              hasActiveDiff: false,
              isShowingDiff: false,
              isDiffReady: false,
              baselineWorkflow: null,
              baselineWorkflowId: null,
              diffAnalysis: null,
              diffMetadata: null,
              diffError: null,
              _triggerMessageId: null,
            })

            // Apply the after-reject state (baseline) and broadcast
            useWorkflowStore.getState().replaceWorkflowState(afterReject)

            // Extract and set subblock values
            const subBlockValues: Record<string, Record<string, any>> = {}
            Object.entries(afterReject.blocks || {}).forEach(([blockId, block]: [string, any]) => {
              subBlockValues[blockId] = {}
              Object.entries(block.subBlocks || {}).forEach(
                ([subBlockId, subBlock]: [string, any]) => {
                  subBlockValues[blockId][subBlockId] = subBlock.value
                }
              )
            })
            useSubBlockStore.getState().setWorkflowValues(activeWorkflowId, subBlockValues)

            // Broadcast state change to other users
            await enqueueReplaceWorkflowState({
              workflowId: activeWorkflowId,
              state: afterReject,
              operationId: opId,
            })
          } finally {
            ;(window as any).__skipDiffRecording = false
          }

          logger.info('Redid reject-diff operation - cleared diff view')
          break
        }
      }

      logger.info('Redo operation completed', {
        type: entry.operation.type,
        workflowId: activeWorkflowId,
        userId,
      })
    })
  }, [activeWorkflowId, userId, addToQueue])

  const getStackSizes = useCallback(() => {
    if (!activeWorkflowId) return { undoSize: 0, redoSize: 0 }
    return useUndoRedoStore.getState().getStackSizes(activeWorkflowId, userId)
  }, [activeWorkflowId, userId])

  const clearStacks = useCallback(() => {
    if (!activeWorkflowId) return
    useUndoRedoStore.getState().clear(activeWorkflowId, userId)
  }, [activeWorkflowId, userId])

  const recordApplyDiff = useCallback(
    (baselineSnapshot: any, proposedState: any, diffAnalysis: any) => {
      if (!activeWorkflowId) return

      const operation: any = {
        id: crypto.randomUUID(),
        type: UNDO_REDO_OPERATIONS.APPLY_DIFF,
        timestamp: Date.now(),
        workflowId: activeWorkflowId,
        userId,
        data: {
          baselineSnapshot,
          proposedState,
          diffAnalysis,
        },
      }

      const inverse: any = {
        id: crypto.randomUUID(),
        type: UNDO_REDO_OPERATIONS.APPLY_DIFF,
        timestamp: Date.now(),
        workflowId: activeWorkflowId,
        userId,
        data: {
          baselineSnapshot,
          proposedState,
          diffAnalysis,
        },
      }

      const entry = createOperationEntry(operation, inverse)
      useUndoRedoStore.getState().push(activeWorkflowId, userId, entry)

      logger.info('Recorded apply-diff operation', {
        workflowId: activeWorkflowId,
        hasBaseline: !!baselineSnapshot,
        hasProposed: !!proposedState,
        baselineBlockCount: Object.keys(baselineSnapshot?.blocks || {}).length,
        proposedBlockCount: Object.keys(proposedState?.blocks || {}).length,
      })
    },
    [activeWorkflowId, userId]
  )

  const recordAcceptDiff = useCallback(
    (beforeAccept: any, afterAccept: any, diffAnalysis: any, baselineSnapshot: any) => {
      if (!activeWorkflowId) return

      const operation: any = {
        id: crypto.randomUUID(),
        type: UNDO_REDO_OPERATIONS.ACCEPT_DIFF,
        timestamp: Date.now(),
        workflowId: activeWorkflowId,
        userId,
        data: {
          beforeAccept,
          afterAccept,
          diffAnalysis,
          baselineSnapshot,
        },
      }

      const inverse: any = {
        id: crypto.randomUUID(),
        type: UNDO_REDO_OPERATIONS.ACCEPT_DIFF,
        timestamp: Date.now(),
        workflowId: activeWorkflowId,
        userId,
        data: {
          beforeAccept,
          afterAccept,
          diffAnalysis,
          baselineSnapshot,
        },
      }

      const entry = createOperationEntry(operation, inverse)
      useUndoRedoStore.getState().push(activeWorkflowId, userId, entry)

      logger.debug('Recorded accept-diff operation', { workflowId: activeWorkflowId })
    },
    [activeWorkflowId, userId]
  )

  const recordRejectDiff = useCallback(
    (beforeReject: any, afterReject: any, diffAnalysis: any, baselineSnapshot: any) => {
      if (!activeWorkflowId) return

      const operation: any = {
        id: crypto.randomUUID(),
        type: UNDO_REDO_OPERATIONS.REJECT_DIFF,
        timestamp: Date.now(),
        workflowId: activeWorkflowId,
        userId,
        data: {
          beforeReject,
          afterReject,
          diffAnalysis,
          baselineSnapshot,
        },
      }

      const inverse: any = {
        id: crypto.randomUUID(),
        type: UNDO_REDO_OPERATIONS.REJECT_DIFF,
        timestamp: Date.now(),
        workflowId: activeWorkflowId,
        userId,
        data: {
          beforeReject,
          afterReject,
          diffAnalysis,
          baselineSnapshot,
        },
      }

      const entry = createOperationEntry(operation, inverse)
      useUndoRedoStore.getState().push(activeWorkflowId, userId, entry)

      logger.info('Recorded reject-diff operation', {
        workflowId: activeWorkflowId,
        beforeBlockCount: Object.keys(beforeReject?.blocks || {}).length,
        afterBlockCount: Object.keys(afterReject?.blocks || {}).length,
      })
    },
    [activeWorkflowId, userId]
  )

  return {
    recordBatchAddBlocks,
    recordBatchRemoveBlocks,
    recordAddEdge,
    recordBatchRemoveEdges,
    recordBatchMoveBlocks,
    recordUpdateParent,
    recordBatchUpdateParent,
    recordBatchToggleEnabled,
    recordBatchToggleHandles,
    recordBatchToggleLocked,
    recordApplyDiff,
    recordAcceptDiff,
    recordRejectDiff,
    undo,
    redo,
    getStackSizes,
    clearStacks,
  }
}
