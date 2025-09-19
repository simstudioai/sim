import { useCallback } from 'react'
import { useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { useOperationQueue } from '@/stores/operation-queue/store'
import {
  createOperationEntry,
  type MoveBlockOperation,
  type Operation,
  type RemoveBlockOperation,
  type RemoveEdgeOperation,
  useUndoRedoStore,
} from '@/stores/undo-redo'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('UndoRedo')

export function useUndoRedo() {
  const { data: session } = useSession()
  const { activeWorkflowId } = useWorkflowRegistry()
  const workflowStore = useWorkflowStore()
  const undoRedoStore = useUndoRedoStore()
  const { addToQueue } = useOperationQueue()

  const userId = session?.user?.id || 'unknown'

  const recordAddBlock = useCallback(
    (
      blockId: string,
      type: string,
      name: string,
      position: { x: number; y: number },
      data?: Record<string, any>,
      parentId?: string,
      extent?: 'parent',
      autoConnectEdge?: any
    ) => {
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
      blockSnapshot: any,
      edgeSnapshots: any[],
      allBlockSnapshots?: Record<string, any>
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
          edgeSnapshot: workflowStore.edges.find((e) => e.id === edgeId),
        },
      }

      const entry = createOperationEntry(operation, inverse)
      undoRedoStore.push(activeWorkflowId, userId, entry)

      logger.debug('Recorded add edge', { edgeId, workflowId: activeWorkflowId })
    },
    [activeWorkflowId, userId, workflowStore, undoRedoStore]
  )

  const recordRemoveEdge = useCallback(
    (edgeId: string, edgeSnapshot: any) => {
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

        // If this is a subflow with nested blocks, restore all of them first
        if (allBlockSnapshots) {
          Object.entries(allBlockSnapshots).forEach(([id, snap]: [string, any]) => {
            if (id !== blockSnapshot.id && !workflowStore.blocks[id]) {
              // Add block locally
              workflowStore.addBlock(
                snap.id,
                snap.type,
                snap.name,
                snap.position,
                snap.data,
                snap.data?.parentId,
                snap.data?.extent
              )

              // Send to server
              addToQueue({
                id: crypto.randomUUID(),
                operation: {
                  operation: 'add',
                  target: 'block',
                  payload: {
                    ...snap,
                    autoConnectEdge: undefined,
                    isUndo: true,
                    originalOpId: entry.id,
                  },
                },
                workflowId: activeWorkflowId,
                userId,
              })

              // Restore subblock values for nested blocks
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

        addToQueue({
          id: opId,
          operation: {
            operation: 'add',
            target: 'block',
            payload: {
              ...blockSnapshot,
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
          blockSnapshot.name,
          blockSnapshot.position,
          blockSnapshot.data,
          blockSnapshot.data?.parentId,
          blockSnapshot.data?.extent
        )

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

        // If this is a subflow with nested blocks, restore all of them first
        if (allBlockSnapshots) {
          Object.entries(allBlockSnapshots).forEach(([id, snapNested]: [string, any]) => {
            if (id !== snap.id && !workflowStore.blocks[id]) {
              // Add block locally
              workflowStore.addBlock(
                snapNested.id,
                snapNested.type,
                snapNested.name,
                snapNested.position,
                snapNested.data,
                snapNested.data?.parentId,
                snapNested.data?.extent
              )

              // Send to server
              addToQueue({
                id: crypto.randomUUID(),
                operation: {
                  operation: 'add',
                  target: 'block',
                  payload: {
                    ...snapNested,
                    autoConnectEdge: undefined,
                    isRedo: true,
                    originalOpId: entry.id,
                  },
                },
                workflowId: activeWorkflowId,
                userId,
              })

              // Restore subblock values for nested blocks
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

        addToQueue({
          id: opId,
          operation: {
            operation: 'add',
            target: 'block',
            payload: { ...snap, isRedo: true, originalOpId: entry.id },
          },
          workflowId: activeWorkflowId,
          userId,
        })
        workflowStore.addBlock(
          snap.id,
          snap.type,
          snap.name,
          snap.position,
          snap.data,
          snap.data?.parentId,
          snap.data?.extent
        )

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
    undo,
    redo,
    getStackSizes,
    clearStacks,
  }
}
