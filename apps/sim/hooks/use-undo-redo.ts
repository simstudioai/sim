import { useCallback } from 'react'
import type { Edge } from 'reactflow'
import { useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { useOperationQueue } from '@/stores/operation-queue/store'
import {
  createOperationEntry,
  type DuplicateBlockOperation,
  type MoveBlockOperation,
  type Operation,
  type RemoveBlockOperation,
  type RemoveEdgeOperation,
  type UpdateParentOperation,
  useUndoRedoStore,
} from '@/stores/undo-redo'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { getUniqueBlockName, mergeSubblockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { BlockState } from '@/stores/workflows/workflow/types'

const logger = createLogger('UndoRedo')

export function useUndoRedo() {
  const { data: session } = useSession()
  const { activeWorkflowId } = useWorkflowRegistry()
  const workflowStore = useWorkflowStore()
  const undoRedoStore = useUndoRedoStore()
  const { addToQueue } = useOperationQueue()

  const userId = session?.user?.id || 'unknown'

  const recordAddBlock = useCallback(
    (blockId: string, autoConnectEdge?: Edge) => {
      if (!activeWorkflowId) return

      const operation: Operation = {
        id: crypto.randomUUID(),
        type: 'add-block',
        timestamp: Date.now(),
        workflowId: activeWorkflowId,
        userId,
        data: { blockId },
      }

      // Get fresh state from store
      const currentBlocks = useWorkflowStore.getState().blocks
      const merged = mergeSubblockState(currentBlocks, activeWorkflowId, blockId)
      const blockSnapshot = merged[blockId] || currentBlocks[blockId]

      const edgesToRemove = autoConnectEdge ? [autoConnectEdge] : []

      const inverse: RemoveBlockOperation = {
        id: crypto.randomUUID(),
        type: 'remove-block',
        timestamp: Date.now(),
        workflowId: activeWorkflowId,
        userId,
        data: {
          blockId,
          blockSnapshot,
          edgeSnapshots: edgesToRemove,
        },
      }

      const entry = createOperationEntry(operation, inverse)
      undoRedoStore.push(activeWorkflowId, userId, entry)

      logger.debug('Recorded add block', {
        blockId,
        hasAutoConnect: !!autoConnectEdge,
        edgeCount: edgesToRemove.length,
        workflowId: activeWorkflowId,
        hasSnapshot: !!blockSnapshot,
      })
    },
    [activeWorkflowId, userId, undoRedoStore]
  )

  const recordRemoveBlock = useCallback(
    (
      blockId: string,
      blockSnapshot: BlockState,
      edgeSnapshots: Edge[],
      allBlockSnapshots?: Record<string, BlockState>
    ) => {
      if (!activeWorkflowId) return

      const operation: RemoveBlockOperation = {
        id: crypto.randomUUID(),
        type: 'remove-block',
        timestamp: Date.now(),
        workflowId: activeWorkflowId,
        userId,
        data: {
          blockId,
          blockSnapshot,
          edgeSnapshots,
          allBlockSnapshots,
        },
      }

      const inverse: Operation = {
        id: crypto.randomUUID(),
        type: 'add-block',
        timestamp: Date.now(),
        workflowId: activeWorkflowId,
        userId,
        data: { blockId },
      }

      const entry = createOperationEntry(operation, inverse)
      undoRedoStore.push(activeWorkflowId, userId, entry)

      logger.debug('Recorded remove block', { blockId, workflowId: activeWorkflowId })
    },
    [activeWorkflowId, userId, undoRedoStore]
  )

  const recordAddEdge = useCallback(
    (edgeId: string) => {
      if (!activeWorkflowId) return

      const operation: Operation = {
        id: crypto.randomUUID(),
        type: 'add-edge',
        timestamp: Date.now(),
        workflowId: activeWorkflowId,
        userId,
        data: { edgeId },
      }

      const inverse: RemoveEdgeOperation = {
        id: crypto.randomUUID(),
        type: 'remove-edge',
        timestamp: Date.now(),
        workflowId: activeWorkflowId,
        userId,
        data: {
          edgeId,
          edgeSnapshot: workflowStore.edges.find((e) => e.id === edgeId) || null,
        },
      }

      const entry = createOperationEntry(operation, inverse)
      undoRedoStore.push(activeWorkflowId, userId, entry)

      logger.debug('Recorded add edge', { edgeId, workflowId: activeWorkflowId })
    },
    [activeWorkflowId, userId, workflowStore, undoRedoStore]
  )

  const recordRemoveEdge = useCallback(
    (edgeId: string, edgeSnapshot: Edge) => {
      if (!activeWorkflowId) return

      const operation: RemoveEdgeOperation = {
        id: crypto.randomUUID(),
        type: 'remove-edge',
        timestamp: Date.now(),
        workflowId: activeWorkflowId,
        userId,
        data: {
          edgeId,
          edgeSnapshot,
        },
      }

      const inverse: Operation = {
        id: crypto.randomUUID(),
        type: 'add-edge',
        timestamp: Date.now(),
        workflowId: activeWorkflowId,
        userId,
        data: { edgeId },
      }

      const entry = createOperationEntry(operation, inverse)
      undoRedoStore.push(activeWorkflowId, userId, entry)

      logger.debug('Recorded remove edge', { edgeId, workflowId: activeWorkflowId })
    },
    [activeWorkflowId, userId, undoRedoStore]
  )

  const recordMove = useCallback(
    (
      blockId: string,
      before: { x: number; y: number; parentId?: string },
      after: { x: number; y: number; parentId?: string }
    ) => {
      if (!activeWorkflowId) return

      const operation: MoveBlockOperation = {
        id: crypto.randomUUID(),
        type: 'move-block',
        timestamp: Date.now(),
        workflowId: activeWorkflowId,
        userId,
        data: {
          blockId,
          before,
          after,
        },
      }

      const inverse: MoveBlockOperation = {
        id: crypto.randomUUID(),
        type: 'move-block',
        timestamp: Date.now(),
        workflowId: activeWorkflowId,
        userId,
        data: {
          blockId,
          before: after,
          after: before,
        },
      }

      const entry = createOperationEntry(operation, inverse)
      undoRedoStore.push(activeWorkflowId, userId, entry)

      logger.debug('Recorded move', { blockId, from: before, to: after })
    },
    [activeWorkflowId, userId, undoRedoStore]
  )

  const recordDuplicateBlock = useCallback(
    (
      sourceBlockId: string,
      duplicatedBlockId: string,
      duplicatedBlockSnapshot: BlockState,
      autoConnectEdge?: Edge
    ) => {
      if (!activeWorkflowId) return

      const operation: DuplicateBlockOperation = {
        id: crypto.randomUUID(),
        type: 'duplicate-block',
        timestamp: Date.now(),
        workflowId: activeWorkflowId,
        userId,
        data: {
          sourceBlockId,
          duplicatedBlockId,
          duplicatedBlockSnapshot,
          autoConnectEdge,
        },
      }

      // Inverse is to remove the duplicated block
      const inverse: RemoveBlockOperation = {
        id: crypto.randomUUID(),
        type: 'remove-block',
        timestamp: Date.now(),
        workflowId: activeWorkflowId,
        userId,
        data: {
          blockId: duplicatedBlockId,
          blockSnapshot: duplicatedBlockSnapshot,
          edgeSnapshots: autoConnectEdge ? [autoConnectEdge] : [],
        },
      }

      const entry = createOperationEntry(operation, inverse)
      undoRedoStore.push(activeWorkflowId, userId, entry)

      logger.debug('Recorded duplicate block', { sourceBlockId, duplicatedBlockId })
    },
    [activeWorkflowId, userId, undoRedoStore]
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
        type: 'update-parent',
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
        type: 'update-parent',
        timestamp: Date.now(),
        workflowId: activeWorkflowId,
        userId,
        data: {
          blockId,
          oldParentId: newParentId,
          newParentId: oldParentId,
          oldPosition: newPosition,
          newPosition: oldPosition,
          affectedEdges, // Same edges need to be restored
        },
      }

      const entry = createOperationEntry(operation, inverse)
      undoRedoStore.push(activeWorkflowId, userId, entry)

      logger.debug('Recorded update parent', {
        blockId,
        oldParentId,
        newParentId,
        edgeCount: affectedEdges?.length || 0,
      })
    },
    [activeWorkflowId, userId, undoRedoStore]
  )

  const undo = useCallback(() => {
    if (!activeWorkflowId) return

    const entry = undoRedoStore.undo(activeWorkflowId, userId)
    if (!entry) {
      logger.debug('No operations to undo')
      return
    }

    const opId = crypto.randomUUID()

    switch (entry.inverse.type) {
      case 'remove-block': {
        const removeInverse = entry.inverse as RemoveBlockOperation
        const blockId = removeInverse.data.blockId

        if (workflowStore.blocks[blockId]) {
          // Refresh inverse snapshot to capture the latest subblock values and edges at undo time
          const mergedNow = mergeSubblockState(workflowStore.blocks, activeWorkflowId, blockId)
          const latestBlockSnapshot = mergedNow[blockId] || workflowStore.blocks[blockId]
          const latestEdgeSnapshots = workflowStore.edges.filter(
            (e) => e.source === blockId || e.target === blockId
          )
          removeInverse.data.blockSnapshot = latestBlockSnapshot
          removeInverse.data.edgeSnapshots = latestEdgeSnapshots
          // First remove the edges that were added with the block (autoConnect edge)
          const edgesToRemove = removeInverse.data.edgeSnapshots || []
          edgesToRemove.forEach((edge) => {
            if (workflowStore.edges.find((e) => e.id === edge.id)) {
              workflowStore.removeEdge(edge.id)
              // Send edge removal to server
              addToQueue({
                id: crypto.randomUUID(),
                operation: {
                  operation: 'remove',
                  target: 'edge',
                  payload: { id: edge.id },
                },
                workflowId: activeWorkflowId,
                userId,
              })
            }
          })

          // Then remove the block
          addToQueue({
            id: opId,
            operation: {
              operation: 'remove',
              target: 'block',
              payload: { id: blockId, isUndo: true, originalOpId: entry.id },
            },
            workflowId: activeWorkflowId,
            userId,
          })
          workflowStore.removeBlock(blockId)
        } else {
          logger.debug('Undo remove-block skipped; block missing', {
            blockId,
          })
        }
        break
      }
      case 'add-block': {
        const originalOp = entry.operation as RemoveBlockOperation
        const { blockSnapshot, edgeSnapshots, allBlockSnapshots } = originalOp.data
        if (!blockSnapshot || workflowStore.blocks[blockSnapshot.id]) {
          logger.debug('Undo add-block skipped', {
            hasSnapshot: Boolean(blockSnapshot),
            exists: Boolean(blockSnapshot && workflowStore.blocks[blockSnapshot.id]),
          })
          break
        }

        const currentBlocks = useWorkflowStore.getState().blocks
        const uniqueName = getUniqueBlockName(blockSnapshot.name, currentBlocks)

        // FIRST: Add the main block (parent subflow) with subBlocks in payload
        addToQueue({
          id: opId,
          operation: {
            operation: 'add',
            target: 'block',
            payload: {
              ...blockSnapshot,
              name: uniqueName,
              subBlocks: blockSnapshot.subBlocks || {},
              autoConnectEdge: undefined,
              isUndo: true,
              originalOpId: entry.id,
            },
          },
          workflowId: activeWorkflowId,
          userId,
        })

        workflowStore.addBlock(
          blockSnapshot.id,
          blockSnapshot.type,
          uniqueName,
          blockSnapshot.position,
          blockSnapshot.data,
          blockSnapshot.data?.parentId,
          blockSnapshot.data?.extent,
          {
            enabled: blockSnapshot.enabled,
            horizontalHandles: blockSnapshot.horizontalHandles,
            isWide: blockSnapshot.isWide,
            advancedMode: blockSnapshot.advancedMode,
            triggerMode: blockSnapshot.triggerMode,
            height: blockSnapshot.height,
          }
        )

        // Set subblock values for the main block locally
        if (blockSnapshot.subBlocks && activeWorkflowId) {
          const subblockValues: Record<string, any> = {}
          Object.entries(blockSnapshot.subBlocks).forEach(
            ([subBlockId, subBlock]: [string, any]) => {
              if (subBlock.value !== null && subBlock.value !== undefined) {
                subblockValues[subBlockId] = subBlock.value
              }
            }
          )

          if (Object.keys(subblockValues).length > 0) {
            useSubBlockStore.setState((state) => ({
              workflowValues: {
                ...state.workflowValues,
                [activeWorkflowId]: {
                  ...state.workflowValues[activeWorkflowId],
                  [blockSnapshot.id]: subblockValues,
                },
              },
            }))
          }
        }

        // SECOND: If this is a subflow with nested blocks, restore them AFTER the parent exists
        if (allBlockSnapshots) {
          Object.entries(allBlockSnapshots).forEach(([id, snap]: [string, any]) => {
            if (id !== blockSnapshot.id && !workflowStore.blocks[id]) {
              const currentBlocksNested = useWorkflowStore.getState().blocks
              const uniqueNestedName = getUniqueBlockName(snap.name, currentBlocksNested)

              // Add nested block locally
              workflowStore.addBlock(
                snap.id,
                snap.type,
                uniqueNestedName,
                snap.position,
                snap.data,
                snap.data?.parentId,
                snap.data?.extent,
                {
                  enabled: snap.enabled,
                  horizontalHandles: snap.horizontalHandles,
                  isWide: snap.isWide,
                  advancedMode: snap.advancedMode,
                  triggerMode: snap.triggerMode,
                  height: snap.height,
                }
              )

              // Send to server with subBlocks included in payload
              addToQueue({
                id: crypto.randomUUID(),
                operation: {
                  operation: 'add',
                  target: 'block',
                  payload: {
                    ...snap,
                    name: uniqueNestedName,
                    subBlocks: snap.subBlocks || {},
                    autoConnectEdge: undefined,
                    isUndo: true,
                    originalOpId: entry.id,
                  },
                },
                workflowId: activeWorkflowId,
                userId,
              })

              // Restore subblock values for nested blocks locally
              if (snap.subBlocks && activeWorkflowId) {
                const subBlockStore = useSubBlockStore.getState()
                Object.entries(snap.subBlocks).forEach(([subBlockId, subBlock]: [string, any]) => {
                  if (subBlock.value !== null && subBlock.value !== undefined) {
                    subBlockStore.setValue(snap.id, subBlockId, subBlock.value)
                  }
                })
              }
            }
          })
        }

        // THIRD: Finally restore edges after all blocks exist
        if (edgeSnapshots && edgeSnapshots.length > 0) {
          edgeSnapshots.forEach((edge) => {
            workflowStore.addEdge(edge)
            addToQueue({
              id: crypto.randomUUID(),
              operation: {
                operation: 'add',
                target: 'edge',
                payload: edge,
              },
              workflowId: activeWorkflowId,
              userId,
            })
          })
        }
        break
      }
      case 'remove-edge': {
        const removeEdgeInverse = entry.inverse as RemoveEdgeOperation
        const { edgeId } = removeEdgeInverse.data
        if (workflowStore.edges.find((e) => e.id === edgeId)) {
          addToQueue({
            id: opId,
            operation: {
              operation: 'remove',
              target: 'edge',
              payload: {
                id: edgeId,
                isUndo: true,
                originalOpId: entry.id,
              },
            },
            workflowId: activeWorkflowId,
            userId,
          })
          workflowStore.removeEdge(edgeId)
        } else {
          logger.debug('Undo remove-edge skipped; edge missing', {
            edgeId,
          })
        }
        break
      }
      case 'add-edge': {
        const originalOp = entry.operation as RemoveEdgeOperation
        const { edgeSnapshot } = originalOp.data
        // Skip if snapshot missing or already exists
        if (!edgeSnapshot || workflowStore.edges.find((e) => e.id === edgeSnapshot.id)) {
          logger.debug('Undo add-edge skipped', {
            hasSnapshot: Boolean(edgeSnapshot),
          })
          break
        }
        addToQueue({
          id: opId,
          operation: {
            operation: 'add',
            target: 'edge',
            payload: { ...edgeSnapshot, isUndo: true, originalOpId: entry.id },
          },
          workflowId: activeWorkflowId,
          userId,
        })
        workflowStore.addEdge(edgeSnapshot)
        break
      }
      case 'move-block': {
        const moveOp = entry.inverse as MoveBlockOperation
        const currentBlocks = useWorkflowStore.getState().blocks
        if (currentBlocks[moveOp.data.blockId]) {
          // Apply the inverse's target as the undo result (inverse.after)
          addToQueue({
            id: opId,
            operation: {
              operation: 'update-position',
              target: 'block',
              payload: {
                id: moveOp.data.blockId,
                position: { x: moveOp.data.after.x, y: moveOp.data.after.y },
                parentId: moveOp.data.after.parentId,
                commit: true,
                isUndo: true,
                originalOpId: entry.id,
              },
            },
            workflowId: activeWorkflowId,
            userId,
          })
          // Use the store from the hook context for React re-renders
          workflowStore.updateBlockPosition(moveOp.data.blockId, {
            x: moveOp.data.after.x,
            y: moveOp.data.after.y,
          })
          if (moveOp.data.after.parentId !== moveOp.data.before.parentId) {
            workflowStore.updateParentId(
              moveOp.data.blockId,
              moveOp.data.after.parentId || '',
              'parent'
            )
          }
        } else {
          logger.debug('Undo move-block skipped; block missing', {
            blockId: moveOp.data.blockId,
          })
        }
        break
      }
      case 'duplicate-block': {
        // Undo duplicate means removing the duplicated block
        const dupOp = entry.operation as DuplicateBlockOperation
        const duplicatedId = dupOp.data.duplicatedBlockId

        if (workflowStore.blocks[duplicatedId]) {
          // Remove any edges connected to the duplicated block
          const edges = workflowStore.edges.filter(
            (edge) => edge.source === duplicatedId || edge.target === duplicatedId
          )
          edges.forEach((edge) => {
            workflowStore.removeEdge(edge.id)
            addToQueue({
              id: crypto.randomUUID(),
              operation: {
                operation: 'remove',
                target: 'edge',
                payload: { id: edge.id },
              },
              workflowId: activeWorkflowId,
              userId,
            })
          })

          // Remove the duplicated block
          addToQueue({
            id: opId,
            operation: {
              operation: 'remove',
              target: 'block',
              payload: { id: duplicatedId, isUndo: true, originalOpId: entry.id },
            },
            workflowId: activeWorkflowId,
            userId,
          })
          workflowStore.removeBlock(duplicatedId)
        } else {
          logger.debug('Undo duplicate-block skipped; duplicated block missing', {
            duplicatedId,
          })
        }
        break
      }
      case 'update-parent': {
        // Undo parent update means reverting to the old parent and position
        const updateOp = entry.inverse as UpdateParentOperation
        const { blockId, newParentId, newPosition, affectedEdges } = updateOp.data

        if (workflowStore.blocks[blockId]) {
          // If we're moving back INTO a subflow, restore edges first
          if (newParentId && affectedEdges && affectedEdges.length > 0) {
            affectedEdges.forEach((edge) => {
              if (!workflowStore.edges.find((e) => e.id === edge.id)) {
                workflowStore.addEdge(edge)
                addToQueue({
                  id: crypto.randomUUID(),
                  operation: {
                    operation: 'add',
                    target: 'edge',
                    payload: { ...edge, isUndo: true },
                  },
                  workflowId: activeWorkflowId,
                  userId,
                })
              }
            })
          }

          // Send position update to server
          addToQueue({
            id: crypto.randomUUID(),
            operation: {
              operation: 'update-position',
              target: 'block',
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

          // Update position locally
          workflowStore.updateBlockPosition(blockId, newPosition)

          // Send parent update to server
          addToQueue({
            id: opId,
            operation: {
              operation: 'update-parent',
              target: 'block',
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

          // Update parent locally
          workflowStore.updateParentId(blockId, newParentId || '', 'parent')

          // If we're removing FROM a subflow (undo of add to subflow), remove edges after
          if (!newParentId && affectedEdges && affectedEdges.length > 0) {
            affectedEdges.forEach((edge) => {
              if (workflowStore.edges.find((e) => e.id === edge.id)) {
                workflowStore.removeEdge(edge.id)
                addToQueue({
                  id: crypto.randomUUID(),
                  operation: {
                    operation: 'remove',
                    target: 'edge',
                    payload: { id: edge.id, isUndo: true },
                  },
                  workflowId: activeWorkflowId,
                  userId,
                })
              }
            })
          }
        } else {
          logger.debug('Undo update-parent skipped; block missing', { blockId })
        }
        break
      }
    }

    logger.info('Undo operation', { type: entry.operation.type, workflowId: activeWorkflowId })
  }, [activeWorkflowId, userId, undoRedoStore, addToQueue, workflowStore])

  const redo = useCallback(() => {
    if (!activeWorkflowId || !userId) return

    const entry = undoRedoStore.redo(activeWorkflowId, userId)
    if (!entry) {
      logger.debug('No operations to redo')
      return
    }

    const opId = crypto.randomUUID()

    switch (entry.operation.type) {
      case 'add-block': {
        // Redo should re-apply the original add: add the block first, then edges
        const inv = entry.inverse as RemoveBlockOperation
        const snap = inv.data.blockSnapshot
        const edgeSnapshots = inv.data.edgeSnapshots || []
        const allBlockSnapshots = inv.data.allBlockSnapshots

        if (!snap || workflowStore.blocks[snap.id]) {
          break
        }

        const currentBlocks = useWorkflowStore.getState().blocks
        const uniqueName = getUniqueBlockName(snap.name, currentBlocks)

        // FIRST: Add the main block (parent subflow) with subBlocks included
        addToQueue({
          id: opId,
          operation: {
            operation: 'add',
            target: 'block',
            payload: {
              ...snap,
              name: uniqueName,
              subBlocks: snap.subBlocks || {},
              isRedo: true,
              originalOpId: entry.id,
            },
          },
          workflowId: activeWorkflowId,
          userId,
        })

        workflowStore.addBlock(
          snap.id,
          snap.type,
          uniqueName,
          snap.position,
          snap.data,
          snap.data?.parentId,
          snap.data?.extent,
          {
            enabled: snap.enabled,
            horizontalHandles: snap.horizontalHandles,
            isWide: snap.isWide,
            advancedMode: snap.advancedMode,
            triggerMode: snap.triggerMode,
            height: snap.height,
          }
        )

        // Set subblock values for the main block locally
        if (snap.subBlocks && activeWorkflowId) {
          const subblockValues: Record<string, any> = {}
          Object.entries(snap.subBlocks).forEach(([subBlockId, subBlock]: [string, any]) => {
            if (subBlock.value !== null && subBlock.value !== undefined) {
              subblockValues[subBlockId] = subBlock.value
            }
          })

          if (Object.keys(subblockValues).length > 0) {
            useSubBlockStore.setState((state) => ({
              workflowValues: {
                ...state.workflowValues,
                [activeWorkflowId]: {
                  ...state.workflowValues[activeWorkflowId],
                  [snap.id]: subblockValues,
                },
              },
            }))
          }
        }

        // SECOND: If this is a subflow with nested blocks, restore them AFTER the parent exists
        if (allBlockSnapshots) {
          Object.entries(allBlockSnapshots).forEach(([id, snapNested]: [string, any]) => {
            if (id !== snap.id && !workflowStore.blocks[id]) {
              const currentBlocksNested = useWorkflowStore.getState().blocks
              const uniqueNestedName = getUniqueBlockName(snapNested.name, currentBlocksNested)

              // Add nested block locally
              workflowStore.addBlock(
                snapNested.id,
                snapNested.type,
                uniqueNestedName,
                snapNested.position,
                snapNested.data,
                snapNested.data?.parentId,
                snapNested.data?.extent,
                {
                  enabled: snapNested.enabled,
                  horizontalHandles: snapNested.horizontalHandles,
                  isWide: snapNested.isWide,
                  advancedMode: snapNested.advancedMode,
                  triggerMode: snapNested.triggerMode,
                  height: snapNested.height,
                }
              )

              // Send to server with subBlocks included
              addToQueue({
                id: crypto.randomUUID(),
                operation: {
                  operation: 'add',
                  target: 'block',
                  payload: {
                    ...snapNested,
                    name: uniqueNestedName,
                    subBlocks: snapNested.subBlocks || {},
                    autoConnectEdge: undefined,
                    isRedo: true,
                    originalOpId: entry.id,
                  },
                },
                workflowId: activeWorkflowId,
                userId,
              })

              // Restore subblock values for nested blocks locally
              if (snapNested.subBlocks && activeWorkflowId) {
                const subBlockStore = useSubBlockStore.getState()
                Object.entries(snapNested.subBlocks).forEach(
                  ([subBlockId, subBlock]: [string, any]) => {
                    if (subBlock.value !== null && subBlock.value !== undefined) {
                      subBlockStore.setValue(snapNested.id, subBlockId, subBlock.value)
                    }
                  }
                )
              }
            }
          })
        }

        // THIRD: Finally restore edges after all blocks exist
        edgeSnapshots.forEach((edge) => {
          if (!workflowStore.edges.find((e) => e.id === edge.id)) {
            workflowStore.addEdge(edge)
            addToQueue({
              id: crypto.randomUUID(),
              operation: {
                operation: 'add',
                target: 'edge',
                payload: { ...edge, isRedo: true, originalOpId: entry.id },
              },
              workflowId: activeWorkflowId,
              userId,
            })
          }
        })
        break
      }
      case 'remove-block': {
        // Redo should re-apply the original remove: remove edges first, then block
        const blockId = entry.operation.data.blockId
        const edgesToRemove = (entry.operation as RemoveBlockOperation).data.edgeSnapshots || []
        edgesToRemove.forEach((edge) => {
          if (workflowStore.edges.find((e) => e.id === edge.id)) {
            workflowStore.removeEdge(edge.id)
            addToQueue({
              id: crypto.randomUUID(),
              operation: {
                operation: 'remove',
                target: 'edge',
                payload: { id: edge.id, isRedo: true, originalOpId: entry.id },
              },
              workflowId: activeWorkflowId,
              userId,
            })
          }
        })

        if (workflowStore.blocks[blockId]) {
          addToQueue({
            id: opId,
            operation: {
              operation: 'remove',
              target: 'block',
              payload: { id: blockId, isRedo: true, originalOpId: entry.id },
            },
            workflowId: activeWorkflowId,
            userId,
          })
          workflowStore.removeBlock(blockId)
        } else {
          logger.debug('Redo remove-block skipped; block missing', { blockId })
        }
        break
      }
      case 'add-edge': {
        // Use snapshot from inverse
        const inv = entry.inverse as RemoveEdgeOperation
        const snap = inv.data.edgeSnapshot
        if (!snap || workflowStore.edges.find((e) => e.id === snap.id)) {
          logger.debug('Redo add-edge skipped', { hasSnapshot: Boolean(snap) })
          break
        }
        addToQueue({
          id: opId,
          operation: {
            operation: 'add',
            target: 'edge',
            payload: { ...snap, isRedo: true, originalOpId: entry.id },
          },
          workflowId: activeWorkflowId,
          userId,
        })
        workflowStore.addEdge(snap)
        break
      }
      case 'remove-edge': {
        const { edgeId } = entry.operation.data
        if (workflowStore.edges.find((e) => e.id === edgeId)) {
          addToQueue({
            id: opId,
            operation: {
              operation: 'remove',
              target: 'edge',
              payload: { id: edgeId, isRedo: true, originalOpId: entry.id },
            },
            workflowId: activeWorkflowId,
            userId,
          })
          workflowStore.removeEdge(edgeId)
        } else {
          logger.debug('Redo remove-edge skipped; edge missing', {
            edgeId,
          })
        }
        break
      }
      case 'move-block': {
        const moveOp = entry.operation as MoveBlockOperation
        const currentBlocks = useWorkflowStore.getState().blocks
        if (currentBlocks[moveOp.data.blockId]) {
          addToQueue({
            id: opId,
            operation: {
              operation: 'update-position',
              target: 'block',
              payload: {
                id: moveOp.data.blockId,
                position: { x: moveOp.data.after.x, y: moveOp.data.after.y },
                parentId: moveOp.data.after.parentId,
                isRedo: true,
                originalOpId: entry.id,
              },
            },
            workflowId: activeWorkflowId,
            userId,
          })
          // Use the store from the hook context for React re-renders
          workflowStore.updateBlockPosition(moveOp.data.blockId, {
            x: moveOp.data.after.x,
            y: moveOp.data.after.y,
          })
          if (moveOp.data.after.parentId !== moveOp.data.before.parentId) {
            workflowStore.updateParentId(
              moveOp.data.blockId,
              moveOp.data.after.parentId || '',
              'parent'
            )
          }
        } else {
          logger.debug('Redo move-block skipped; block missing', {
            blockId: moveOp.data.blockId,
          })
        }
        break
      }
      case 'duplicate-block': {
        // Redo duplicate means re-adding the duplicated block
        const dupOp = entry.operation as DuplicateBlockOperation
        const { duplicatedBlockSnapshot, autoConnectEdge } = dupOp.data

        if (!duplicatedBlockSnapshot || workflowStore.blocks[duplicatedBlockSnapshot.id]) {
          logger.debug('Redo duplicate-block skipped', {
            hasSnapshot: Boolean(duplicatedBlockSnapshot),
            exists: Boolean(
              duplicatedBlockSnapshot && workflowStore.blocks[duplicatedBlockSnapshot.id]
            ),
          })
          break
        }

        const currentBlocks = useWorkflowStore.getState().blocks
        const uniqueName = getUniqueBlockName(duplicatedBlockSnapshot.name, currentBlocks)

        // Add the duplicated block
        addToQueue({
          id: opId,
          operation: {
            operation: 'duplicate',
            target: 'block',
            payload: {
              ...duplicatedBlockSnapshot,
              name: uniqueName,
              subBlocks: duplicatedBlockSnapshot.subBlocks || {},
              autoConnectEdge,
              isRedo: true,
              originalOpId: entry.id,
            },
          },
          workflowId: activeWorkflowId,
          userId,
        })

        workflowStore.addBlock(
          duplicatedBlockSnapshot.id,
          duplicatedBlockSnapshot.type,
          uniqueName,
          duplicatedBlockSnapshot.position,
          duplicatedBlockSnapshot.data,
          duplicatedBlockSnapshot.data?.parentId,
          duplicatedBlockSnapshot.data?.extent,
          {
            enabled: duplicatedBlockSnapshot.enabled,
            horizontalHandles: duplicatedBlockSnapshot.horizontalHandles,
            isWide: duplicatedBlockSnapshot.isWide,
            advancedMode: duplicatedBlockSnapshot.advancedMode,
            triggerMode: duplicatedBlockSnapshot.triggerMode,
            height: duplicatedBlockSnapshot.height,
          }
        )

        // Restore subblock values
        if (duplicatedBlockSnapshot.subBlocks && activeWorkflowId) {
          const subblockValues: Record<string, any> = {}
          Object.entries(duplicatedBlockSnapshot.subBlocks).forEach(
            ([subBlockId, subBlock]: [string, any]) => {
              if (subBlock.value !== null && subBlock.value !== undefined) {
                subblockValues[subBlockId] = subBlock.value
              }
            }
          )

          if (Object.keys(subblockValues).length > 0) {
            useSubBlockStore.setState((state) => ({
              workflowValues: {
                ...state.workflowValues,
                [activeWorkflowId]: {
                  ...state.workflowValues[activeWorkflowId],
                  [duplicatedBlockSnapshot.id]: subblockValues,
                },
              },
            }))
          }
        }

        // Add auto-connect edge if present
        if (autoConnectEdge && !workflowStore.edges.find((e) => e.id === autoConnectEdge.id)) {
          workflowStore.addEdge(autoConnectEdge)
          addToQueue({
            id: crypto.randomUUID(),
            operation: {
              operation: 'add',
              target: 'edge',
              payload: { ...autoConnectEdge, isRedo: true, originalOpId: entry.id },
            },
            workflowId: activeWorkflowId,
            userId,
          })
        }
        break
      }
      case 'update-parent': {
        // Redo parent update means applying the new parent and position
        const updateOp = entry.operation as UpdateParentOperation
        const { blockId, newParentId, newPosition, affectedEdges } = updateOp.data

        if (workflowStore.blocks[blockId]) {
          // If we're removing FROM a subflow, remove edges first
          if (!newParentId && affectedEdges && affectedEdges.length > 0) {
            affectedEdges.forEach((edge) => {
              if (workflowStore.edges.find((e) => e.id === edge.id)) {
                workflowStore.removeEdge(edge.id)
                addToQueue({
                  id: crypto.randomUUID(),
                  operation: {
                    operation: 'remove',
                    target: 'edge',
                    payload: { id: edge.id, isRedo: true },
                  },
                  workflowId: activeWorkflowId,
                  userId,
                })
              }
            })
          }

          // Send position update to server
          addToQueue({
            id: crypto.randomUUID(),
            operation: {
              operation: 'update-position',
              target: 'block',
              payload: {
                id: blockId,
                position: newPosition,
                isRedo: true,
                originalOpId: entry.id,
              },
            },
            workflowId: activeWorkflowId,
            userId,
          })

          // Update position locally
          workflowStore.updateBlockPosition(blockId, newPosition)

          // Send parent update to server
          addToQueue({
            id: opId,
            operation: {
              operation: 'update-parent',
              target: 'block',
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

          // Update parent locally
          workflowStore.updateParentId(blockId, newParentId || '', 'parent')

          // If we're adding TO a subflow, restore edges after
          if (newParentId && affectedEdges && affectedEdges.length > 0) {
            affectedEdges.forEach((edge) => {
              if (!workflowStore.edges.find((e) => e.id === edge.id)) {
                workflowStore.addEdge(edge)
                addToQueue({
                  id: crypto.randomUUID(),
                  operation: {
                    operation: 'add',
                    target: 'edge',
                    payload: { ...edge, isRedo: true },
                  },
                  workflowId: activeWorkflowId,
                  userId,
                })
              }
            })
          }
        } else {
          logger.debug('Redo update-parent skipped; block missing', { blockId })
        }
        break
      }
    }

    logger.info('Redo operation completed', {
      type: entry.operation.type,
      workflowId: activeWorkflowId,
      userId,
    })
  }, [activeWorkflowId, userId, undoRedoStore, addToQueue, workflowStore])

  const getStackSizes = useCallback(() => {
    if (!activeWorkflowId) return { undoSize: 0, redoSize: 0 }
    return undoRedoStore.getStackSizes(activeWorkflowId, userId)
  }, [activeWorkflowId, userId, undoRedoStore])

  const clearStacks = useCallback(() => {
    if (!activeWorkflowId) return
    undoRedoStore.clear(activeWorkflowId, userId)
  }, [activeWorkflowId, userId, undoRedoStore])

  return {
    recordAddBlock,
    recordRemoveBlock,
    recordAddEdge,
    recordRemoveEdge,
    recordMove,
    recordDuplicateBlock,
    recordUpdateParent,
    undo,
    redo,
    getStackSizes,
    clearStacks,
  }
}
