import { useCallback } from 'react'
import { createLogger } from '@sim/logger'
import type { Edge } from 'reactflow'
import { useSession } from '@/lib/auth/auth-client'
import { enqueueReplaceWorkflowState } from '@/lib/workflows/operations/socket-operations'
import { useOperationQueue } from '@/stores/operation-queue/store'
import {
  type BatchAddBlocksOperation,
  type BatchRemoveBlocksOperation,
  createOperationEntry,
  type MoveBlockOperation,
  type Operation,
  type RemoveEdgeOperation,
  runWithUndoRedoRecordingSuspended,
  type UpdateParentOperation,
  useUndoRedoStore,
} from '@/stores/undo-redo'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { mergeSubblockState } from '@/stores/workflows/utils'
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

  const recordBatchAddBlocks = useCallback(
    (
      blockSnapshots: BlockState[],
      edgeSnapshots: Edge[] = [],
      subBlockValues: Record<string, Record<string, unknown>> = {}
    ) => {
      if (!activeWorkflowId || blockSnapshots.length === 0) return

      const operation: BatchAddBlocksOperation = {
        id: crypto.randomUUID(),
        type: 'batch-add-blocks',
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
        type: 'batch-remove-blocks',
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
      undoRedoStore.push(activeWorkflowId, userId, entry)

      logger.debug('Recorded batch add blocks', {
        blockCount: blockSnapshots.length,
        edgeCount: edgeSnapshots.length,
        workflowId: activeWorkflowId,
      })
    },
    [activeWorkflowId, userId, undoRedoStore]
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
        type: 'batch-remove-blocks',
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
        type: 'batch-add-blocks',
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
      undoRedoStore.push(activeWorkflowId, userId, entry)

      logger.debug('Recorded batch remove blocks', {
        blockCount: blockSnapshots.length,
        edgeCount: edgeSnapshots.length,
        workflowId: activeWorkflowId,
      })
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

  const undo = useCallback(async () => {
    if (!activeWorkflowId) return

    await runWithUndoRedoRecordingSuspended(async () => {
      const entry = undoRedoStore.undo(activeWorkflowId, userId)
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
        case 'batch-remove-blocks': {
          const batchRemoveOp = entry.inverse as BatchRemoveBlocksOperation
          const { blockSnapshots } = batchRemoveOp.data
          const blockIds = blockSnapshots.map((b) => b.id)

          const existingBlockIds = blockIds.filter((id) => workflowStore.blocks[id])
          if (existingBlockIds.length === 0) {
            logger.debug('Undo batch-remove-blocks skipped; no blocks exist')
            break
          }

          const latestEdges = workflowStore.edges.filter(
            (e) => existingBlockIds.includes(e.source) || existingBlockIds.includes(e.target)
          )
          batchRemoveOp.data.edgeSnapshots = latestEdges

          const latestSubBlockValues: Record<string, Record<string, unknown>> = {}
          existingBlockIds.forEach((blockId) => {
            const merged = mergeSubblockState(workflowStore.blocks, activeWorkflowId, blockId)
            const block = merged[blockId]
            if (block?.subBlocks) {
              const values: Record<string, unknown> = {}
              Object.entries(block.subBlocks).forEach(([subBlockId, subBlock]) => {
                if (subBlock.value !== null && subBlock.value !== undefined) {
                  values[subBlockId] = subBlock.value
                }
              })
              if (Object.keys(values).length > 0) {
                latestSubBlockValues[blockId] = values
              }
            }
          })
          batchRemoveOp.data.subBlockValues = latestSubBlockValues

          addToQueue({
            id: opId,
            operation: {
              operation: 'batch-remove-blocks',
              target: 'blocks',
              payload: { ids: existingBlockIds },
            },
            workflowId: activeWorkflowId,
            userId,
          })

          existingBlockIds.forEach((id) => workflowStore.removeBlock(id))
          break
        }
        case 'batch-add-blocks': {
          const batchAddOp = entry.operation as BatchAddBlocksOperation
          const { blockSnapshots, edgeSnapshots, subBlockValues } = batchAddOp.data

          const blocksToAdd = blockSnapshots.filter((b) => !workflowStore.blocks[b.id])
          if (blocksToAdd.length === 0) {
            logger.debug('Undo batch-add-blocks skipped; all blocks exist')
            break
          }

          addToQueue({
            id: opId,
            operation: {
              operation: 'batch-add-blocks',
              target: 'blocks',
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

          blocksToAdd.forEach((block) => {
            workflowStore.addBlock(
              block.id,
              block.type,
              block.name,
              block.position,
              block.data,
              block.data?.parentId,
              block.data?.extent,
              {
                enabled: block.enabled,
                horizontalHandles: block.horizontalHandles,
                advancedMode: block.advancedMode,
                triggerMode: block.triggerMode,
                height: block.height,
              }
            )
          })

          if (subBlockValues && Object.keys(subBlockValues).length > 0) {
            useSubBlockStore.setState((state) => ({
              workflowValues: {
                ...state.workflowValues,
                [activeWorkflowId]: {
                  ...state.workflowValues[activeWorkflowId],
                  ...subBlockValues,
                },
              },
            }))
          }

          if (edgeSnapshots && edgeSnapshots.length > 0) {
            edgeSnapshots.forEach((edge) => {
              if (!workflowStore.edges.find((e) => e.id === edge.id)) {
                workflowStore.addEdge(edge)
              }
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
        case 'apply-diff': {
          // Undo apply-diff means clearing the diff and restoring baseline
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
        case 'accept-diff': {
          // Undo accept-diff means restoring diff view with markers
          const acceptDiffInverse = entry.inverse as any
          const acceptDiffOp = entry.operation as any
          const { beforeAccept, diffAnalysis } = acceptDiffInverse.data
          const { baselineSnapshot } = acceptDiffOp.data
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
        case 'reject-diff': {
          // Undo reject-diff means restoring diff view with markers
          const rejectDiffInverse = entry.inverse as any
          const rejectDiffOp = entry.operation as any
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
  }, [activeWorkflowId, userId, undoRedoStore, addToQueue, workflowStore])

  const redo = useCallback(async () => {
    if (!activeWorkflowId || !userId) return

    await runWithUndoRedoRecordingSuspended(async () => {
      const entry = undoRedoStore.redo(activeWorkflowId, userId)
      if (!entry) {
        logger.debug('No operations to redo')
        return
      }

      const opId = crypto.randomUUID()

      switch (entry.operation.type) {
        case 'batch-add-blocks': {
          const batchOp = entry.operation as BatchAddBlocksOperation
          const { blockSnapshots, edgeSnapshots, subBlockValues } = batchOp.data

          const blocksToAdd = blockSnapshots.filter((b) => !workflowStore.blocks[b.id])
          if (blocksToAdd.length === 0) {
            logger.debug('Redo batch-add-blocks skipped; all blocks exist')
            break
          }

          addToQueue({
            id: opId,
            operation: {
              operation: 'batch-add-blocks',
              target: 'blocks',
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

          blocksToAdd.forEach((block) => {
            workflowStore.addBlock(
              block.id,
              block.type,
              block.name,
              block.position,
              block.data,
              block.data?.parentId,
              block.data?.extent,
              {
                enabled: block.enabled,
                horizontalHandles: block.horizontalHandles,
                advancedMode: block.advancedMode,
                triggerMode: block.triggerMode,
                height: block.height,
              }
            )
          })

          if (subBlockValues && Object.keys(subBlockValues).length > 0) {
            useSubBlockStore.setState((state) => ({
              workflowValues: {
                ...state.workflowValues,
                [activeWorkflowId]: {
                  ...state.workflowValues[activeWorkflowId],
                  ...subBlockValues,
                },
              },
            }))
          }

          if (edgeSnapshots && edgeSnapshots.length > 0) {
            edgeSnapshots.forEach((edge) => {
              if (!workflowStore.edges.find((e) => e.id === edge.id)) {
                workflowStore.addEdge(edge)
              }
            })
          }
          break
        }
        case 'batch-remove-blocks': {
          const batchOp = entry.operation as BatchRemoveBlocksOperation
          const { blockSnapshots } = batchOp.data
          const blockIds = blockSnapshots.map((b) => b.id)

          const existingBlockIds = blockIds.filter((id) => workflowStore.blocks[id])
          if (existingBlockIds.length === 0) {
            logger.debug('Redo batch-remove-blocks skipped; no blocks exist')
            break
          }

          addToQueue({
            id: opId,
            operation: {
              operation: 'batch-remove-blocks',
              target: 'blocks',
              payload: { ids: existingBlockIds },
            },
            workflowId: activeWorkflowId,
            userId,
          })

          existingBlockIds.forEach((id) => workflowStore.removeBlock(id))
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
                  commit: true,
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
                  commit: true,
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
        case 'apply-diff': {
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
        case 'accept-diff': {
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
        case 'reject-diff': {
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
  }, [activeWorkflowId, userId, undoRedoStore, addToQueue, workflowStore])

  const getStackSizes = useCallback(() => {
    if (!activeWorkflowId) return { undoSize: 0, redoSize: 0 }
    return undoRedoStore.getStackSizes(activeWorkflowId, userId)
  }, [activeWorkflowId, userId, undoRedoStore])

  const clearStacks = useCallback(() => {
    if (!activeWorkflowId) return
    undoRedoStore.clear(activeWorkflowId, userId)
  }, [activeWorkflowId, userId, undoRedoStore])

  const recordApplyDiff = useCallback(
    (baselineSnapshot: any, proposedState: any, diffAnalysis: any) => {
      if (!activeWorkflowId) return

      const operation: any = {
        id: crypto.randomUUID(),
        type: 'apply-diff',
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
        type: 'apply-diff',
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
      undoRedoStore.push(activeWorkflowId, userId, entry)

      logger.info('Recorded apply-diff operation', {
        workflowId: activeWorkflowId,
        hasBaseline: !!baselineSnapshot,
        hasProposed: !!proposedState,
        baselineBlockCount: Object.keys(baselineSnapshot?.blocks || {}).length,
        proposedBlockCount: Object.keys(proposedState?.blocks || {}).length,
      })
    },
    [activeWorkflowId, userId, undoRedoStore]
  )

  const recordAcceptDiff = useCallback(
    (beforeAccept: any, afterAccept: any, diffAnalysis: any, baselineSnapshot: any) => {
      if (!activeWorkflowId) return

      const operation: any = {
        id: crypto.randomUUID(),
        type: 'accept-diff',
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
        type: 'accept-diff',
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
      undoRedoStore.push(activeWorkflowId, userId, entry)

      logger.debug('Recorded accept-diff operation', { workflowId: activeWorkflowId })
    },
    [activeWorkflowId, userId, undoRedoStore]
  )

  const recordRejectDiff = useCallback(
    (beforeReject: any, afterReject: any, diffAnalysis: any, baselineSnapshot: any) => {
      if (!activeWorkflowId) return

      const operation: any = {
        id: crypto.randomUUID(),
        type: 'reject-diff',
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
        type: 'reject-diff',
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
      undoRedoStore.push(activeWorkflowId, userId, entry)

      logger.info('Recorded reject-diff operation', {
        workflowId: activeWorkflowId,
        beforeBlockCount: Object.keys(beforeReject?.blocks || {}).length,
        afterBlockCount: Object.keys(afterReject?.blocks || {}).length,
      })
    },
    [activeWorkflowId, userId, undoRedoStore]
  )

  return {
    recordBatchAddBlocks,
    recordBatchRemoveBlocks,
    recordAddEdge,
    recordRemoveEdge,
    recordMove,
    recordUpdateParent,
    recordApplyDiff,
    recordAcceptDiff,
    recordRejectDiff,
    undo,
    redo,
    getStackSizes,
    clearStacks,
  }
}
