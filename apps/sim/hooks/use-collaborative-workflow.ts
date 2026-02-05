import { useCallback, useEffect, useRef } from 'react'
import { createLogger } from '@sim/logger'
import type { Edge } from 'reactflow'
import { useShallow } from 'zustand/react/shallow'
import { useSession } from '@/lib/auth/auth-client'
import { useSocket } from '@/app/workspace/providers/socket-provider'
import { getBlock } from '@/blocks'
import { normalizeName, RESERVED_BLOCK_NAMES } from '@/executor/constants'
import { useUndoRedo } from '@/hooks/use-undo-redo'
import {
  BLOCK_OPERATIONS,
  BLOCKS_OPERATIONS,
  EDGES_OPERATIONS,
  OPERATION_TARGETS,
  SUBBLOCK_OPERATIONS,
  SUBFLOW_OPERATIONS,
  VARIABLE_OPERATIONS,
  WORKFLOW_OPERATIONS,
} from '@/socket/constants'
import { useNotificationStore } from '@/stores/notifications'
import { registerEmitFunctions, useOperationQueue } from '@/stores/operation-queue/store'
import { usePanelEditorStore, useVariablesStore } from '@/stores/panel'
import { useCodeUndoRedoStore, useUndoRedoStore } from '@/stores/undo-redo'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { filterNewEdges, filterValidEdges, mergeSubblockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { BlockState, Loop, Parallel, Position } from '@/stores/workflows/workflow/types'

const logger = createLogger('CollaborativeWorkflow')

export function useCollaborativeWorkflow() {
  const undoRedo = useUndoRedo()
  const isUndoRedoInProgress = useRef(false)
  const lastDiffOperationId = useRef<string | null>(null)

  useEffect(() => {
    const moveHandler = (e: any) => {
      const { blockId, before, after } = e.detail || {}
      if (!blockId || !before || !after) return
      if (isUndoRedoInProgress.current) return
      undoRedo.recordBatchMoveBlocks([{ blockId, before, after }])
    }

    const parentUpdateHandler = (e: any) => {
      const { blockId, oldParentId, newParentId, oldPosition, newPosition, affectedEdges } =
        e.detail || {}
      if (!blockId) return
      if (isUndoRedoInProgress.current) return
      undoRedo.recordUpdateParent(
        blockId,
        oldParentId,
        newParentId,
        oldPosition,
        newPosition,
        affectedEdges
      )
    }

    const diffOperationHandler = (e: any) => {
      const {
        type,
        baselineSnapshot,
        proposedState,
        diffAnalysis,
        beforeAccept,
        afterAccept,
        beforeReject,
        afterReject,
      } = e.detail || {}
      // Don't record during undo/redo operations
      if (isUndoRedoInProgress.current) return

      // Generate a unique ID for this diff operation to prevent duplicates
      // Use block keys from the relevant states for each operation type
      let stateForId
      if (type === 'apply-diff') {
        stateForId = proposedState
      } else if (type === 'accept-diff') {
        stateForId = afterAccept
      } else if (type === 'reject-diff') {
        stateForId = afterReject
      }

      const blockKeys = stateForId?.blocks ? Object.keys(stateForId.blocks).sort().join(',') : ''
      const operationId = `${type}-${blockKeys}`

      if (lastDiffOperationId.current === operationId) {
        logger.debug('Skipping duplicate diff operation', { type, operationId })
        return // Skip duplicate
      }
      lastDiffOperationId.current = operationId

      if (type === 'apply-diff' && baselineSnapshot && proposedState) {
        undoRedo.recordApplyDiff(baselineSnapshot, proposedState, diffAnalysis)
      } else if (type === 'accept-diff' && beforeAccept && afterAccept) {
        undoRedo.recordAcceptDiff(beforeAccept, afterAccept, diffAnalysis, baselineSnapshot)
      } else if (type === 'reject-diff' && beforeReject && afterReject) {
        undoRedo.recordRejectDiff(beforeReject, afterReject, diffAnalysis, baselineSnapshot)
      }
    }

    window.addEventListener('workflow-record-move', moveHandler)
    window.addEventListener('workflow-record-parent-update', parentUpdateHandler)
    window.addEventListener('record-diff-operation', diffOperationHandler)
    return () => {
      window.removeEventListener('workflow-record-move', moveHandler)
      window.removeEventListener('workflow-record-parent-update', parentUpdateHandler)
      window.removeEventListener('record-diff-operation', diffOperationHandler)
    }
  }, [undoRedo])
  const {
    isConnected,
    currentWorkflowId,
    emitWorkflowOperation,
    emitSubblockUpdate,
    emitVariableUpdate,
    onWorkflowOperation,
    onSubblockUpdate,
    onVariableUpdate,
    onWorkflowDeleted,
    onWorkflowReverted,
    onOperationConfirmed,
    onOperationFailed,
  } = useSocket()

  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const { data: session } = useSession()
  const { hasActiveDiff, isShowingDiff } = useWorkflowDiffStore(
    useShallow((state) => ({
      hasActiveDiff: state.hasActiveDiff,
      isShowingDiff: state.isShowingDiff,
    }))
  )
  const isBaselineDiffView = hasActiveDiff && !isShowingDiff

  // Track if we're applying remote changes to avoid infinite loops
  const isApplyingRemoteChange = useRef(false)

  const {
    addToQueue,
    confirmOperation,
    failOperation,
    cancelOperationsForBlock,
    cancelOperationsForVariable,
  } = useOperationQueue()

  // Register emit functions with operation queue store
  useEffect(() => {
    registerEmitFunctions(
      emitWorkflowOperation,
      emitSubblockUpdate,
      emitVariableUpdate,
      currentWorkflowId
    )
  }, [emitWorkflowOperation, emitSubblockUpdate, emitVariableUpdate, currentWorkflowId])

  useEffect(() => {
    const handleWorkflowOperation = (data: any) => {
      const { operation, target, payload, userId, metadata } = data

      if (isApplyingRemoteChange.current) return

      // Filter broadcasts by workflowId to prevent cross-workflow updates
      if (metadata?.workflowId && metadata.workflowId !== activeWorkflowId) {
        logger.debug('Ignoring workflow operation for different workflow', {
          broadcastWorkflowId: metadata.workflowId,
          activeWorkflowId,
        })
        return
      }

      logger.info(`Received ${operation} on ${target} from user ${userId}`)

      // Apply the operation to local state
      isApplyingRemoteChange.current = true

      try {
        if (target === OPERATION_TARGETS.BLOCK) {
          switch (operation) {
            case BLOCK_OPERATIONS.UPDATE_NAME:
              useWorkflowStore.getState().updateBlockName(payload.id, payload.name)
              break
            case BLOCK_OPERATIONS.UPDATE_ADVANCED_MODE:
              useWorkflowStore.getState().setBlockAdvancedMode(payload.id, payload.advancedMode)
              break
            case BLOCK_OPERATIONS.UPDATE_CANONICAL_MODE:
              useWorkflowStore
                .getState()
                .setBlockCanonicalMode(payload.id, payload.canonicalId, payload.canonicalMode)
              break
          }
        } else if (target === OPERATION_TARGETS.BLOCKS) {
          switch (operation) {
            case BLOCKS_OPERATIONS.BATCH_UPDATE_POSITIONS: {
              const { updates } = payload
              if (Array.isArray(updates)) {
                useWorkflowStore.getState().batchUpdatePositions(updates)
              }
              break
            }
          }
        } else if (target === OPERATION_TARGETS.EDGES) {
          switch (operation) {
            case EDGES_OPERATIONS.BATCH_REMOVE_EDGES: {
              const { ids } = payload
              if (Array.isArray(ids) && ids.length > 0) {
                useWorkflowStore.getState().batchRemoveEdges(ids)

                const updatedBlocks = useWorkflowStore.getState().blocks
                const updatedEdges = useWorkflowStore.getState().edges
                const graph = {
                  blocksById: updatedBlocks,
                  edgesById: Object.fromEntries(updatedEdges.map((e) => [e.id, e])),
                }

                const undoRedoStore = useUndoRedoStore.getState()
                const stackKeys = Object.keys(undoRedoStore.stacks)
                stackKeys.forEach((key) => {
                  const [wfId, uId] = key.split(':')
                  if (wfId === activeWorkflowId) {
                    undoRedoStore.pruneInvalidEntries(wfId, uId, graph)
                  }
                })
              }
              break
            }
            case EDGES_OPERATIONS.BATCH_ADD_EDGES: {
              const { edges } = payload
              if (Array.isArray(edges) && edges.length > 0) {
                const blocks = useWorkflowStore.getState().blocks
                const currentEdges = useWorkflowStore.getState().edges
                const validEdges = filterValidEdges(edges, blocks)
                const newEdges = filterNewEdges(validEdges, currentEdges)
                if (newEdges.length > 0) {
                  useWorkflowStore.getState().batchAddEdges(newEdges, { skipValidation: true })
                }
              }
              break
            }
          }
        } else if (target === OPERATION_TARGETS.SUBFLOW) {
          switch (operation) {
            case SUBFLOW_OPERATIONS.UPDATE:
              // Handle subflow configuration updates (loop/parallel type changes, etc.)
              if (payload.type === 'loop') {
                const { config } = payload
                if (config.loopType !== undefined) {
                  useWorkflowStore.getState().updateLoopType(payload.id, config.loopType)
                }
                if (config.iterations !== undefined) {
                  useWorkflowStore.getState().updateLoopCount(payload.id, config.iterations)
                }
                if (config.forEachItems !== undefined) {
                  useWorkflowStore.getState().setLoopForEachItems(payload.id, config.forEachItems)
                }
                if (config.whileCondition !== undefined) {
                  useWorkflowStore
                    .getState()
                    .setLoopWhileCondition(payload.id, config.whileCondition)
                }
                if (config.doWhileCondition !== undefined) {
                  useWorkflowStore
                    .getState()
                    .setLoopDoWhileCondition(payload.id, config.doWhileCondition)
                }
              } else if (payload.type === 'parallel') {
                const { config } = payload
                if (config.parallelType !== undefined) {
                  useWorkflowStore.getState().updateParallelType(payload.id, config.parallelType)
                }
                if (config.count !== undefined) {
                  useWorkflowStore.getState().updateParallelCount(payload.id, config.count)
                }
                if (config.distribution !== undefined) {
                  useWorkflowStore
                    .getState()
                    .updateParallelCollection(payload.id, config.distribution)
                }
              }
              break
          }
        } else if (target === OPERATION_TARGETS.VARIABLE) {
          switch (operation) {
            case VARIABLE_OPERATIONS.ADD:
              useVariablesStore.getState().addVariable(
                {
                  workflowId: payload.workflowId,
                  name: payload.name,
                  type: payload.type,
                  value: payload.value,
                },
                payload.id
              )
              break
            case VARIABLE_OPERATIONS.UPDATE:
              if (payload.field === 'name') {
                useVariablesStore
                  .getState()
                  .updateVariable(payload.variableId, { name: payload.value })
              } else if (payload.field === 'value') {
                useVariablesStore
                  .getState()
                  .updateVariable(payload.variableId, { value: payload.value })
              } else if (payload.field === 'type') {
                useVariablesStore
                  .getState()
                  .updateVariable(payload.variableId, { type: payload.value })
              }
              break
            case VARIABLE_OPERATIONS.REMOVE:
              useVariablesStore.getState().deleteVariable(payload.variableId)
              break
          }
        } else if (target === OPERATION_TARGETS.WORKFLOW) {
          switch (operation) {
            case WORKFLOW_OPERATIONS.REPLACE_STATE:
              if (payload.state) {
                logger.info('Received workflow state replacement from remote user', {
                  userId,
                  blockCount: Object.keys(payload.state.blocks || {}).length,
                  edgeCount: (payload.state.edges || []).length,
                  hasActiveDiff,
                  isShowingDiff,
                })
                useWorkflowStore.getState().replaceWorkflowState(payload.state)

                // Extract and apply subblock values
                const subBlockValues: Record<string, Record<string, any>> = {}
                Object.entries(payload.state.blocks || {}).forEach(
                  ([blockId, block]: [string, any]) => {
                    subBlockValues[blockId] = {}
                    Object.entries(block.subBlocks || {}).forEach(
                      ([subBlockId, subBlock]: [string, any]) => {
                        subBlockValues[blockId][subBlockId] = subBlock.value
                      }
                    )
                  }
                )
                if (activeWorkflowId) {
                  useSubBlockStore.getState().setWorkflowValues(activeWorkflowId, subBlockValues)
                }

                logger.info('Successfully applied remote workflow state replacement')
              }
              break
          }
        }

        if (target === OPERATION_TARGETS.BLOCKS) {
          switch (operation) {
            case BLOCKS_OPERATIONS.BATCH_ADD_BLOCKS: {
              const { blocks, edges, subBlockValues: addedSubBlockValues } = payload
              logger.info('Received batch-add-blocks from remote user', {
                userId,
                blockCount: (blocks || []).length,
                edgeCount: (edges || []).length,
              })

              if (blocks && blocks.length > 0) {
                useWorkflowStore
                  .getState()
                  .batchAddBlocks(blocks, edges || [], addedSubBlockValues || {})
              }

              logger.info('Successfully applied batch-add-blocks from remote user')
              break
            }
            case BLOCKS_OPERATIONS.BATCH_REMOVE_BLOCKS: {
              const { ids } = payload
              logger.info('Received batch-remove-blocks from remote user', {
                userId,
                count: (ids || []).length,
              })

              if (ids && ids.length > 0) {
                useWorkflowStore.getState().batchRemoveBlocks(ids)
              }

              logger.info('Successfully applied batch-remove-blocks from remote user')
              break
            }
            case BLOCKS_OPERATIONS.BATCH_TOGGLE_ENABLED: {
              const { blockIds } = payload
              logger.info('Received batch-toggle-enabled from remote user', {
                userId,
                count: (blockIds || []).length,
              })

              if (blockIds && blockIds.length > 0) {
                useWorkflowStore.getState().batchToggleEnabled(blockIds)
              }

              logger.info('Successfully applied batch-toggle-enabled from remote user')
              break
            }
            case BLOCKS_OPERATIONS.BATCH_TOGGLE_HANDLES: {
              const { blockIds } = payload
              logger.info('Received batch-toggle-handles from remote user', {
                userId,
                count: (blockIds || []).length,
              })

              if (blockIds && blockIds.length > 0) {
                useWorkflowStore.getState().batchToggleHandles(blockIds)
              }

              logger.info('Successfully applied batch-toggle-handles from remote user')
              break
            }
            case BLOCKS_OPERATIONS.BATCH_TOGGLE_LOCKED: {
              const { blockIds } = payload
              logger.info('Received batch-toggle-locked from remote user', {
                userId,
                count: (blockIds || []).length,
              })

              if (blockIds && blockIds.length > 0) {
                useWorkflowStore.getState().batchToggleLocked(blockIds)
              }

              logger.info('Successfully applied batch-toggle-locked from remote user')
              break
            }
            case BLOCKS_OPERATIONS.BATCH_UPDATE_PARENT: {
              const { updates } = payload
              logger.info('Received batch-update-parent from remote user', {
                userId,
                count: (updates || []).length,
              })

              if (updates && updates.length > 0) {
                useWorkflowStore.getState().batchUpdateBlocksWithParent(
                  updates.map(
                    (u: { id: string; parentId: string; position: { x: number; y: number } }) => ({
                      id: u.id,
                      position: u.position,
                      parentId: u.parentId || undefined,
                    })
                  )
                )
              }

              logger.info('Successfully applied batch-update-parent from remote user')
              break
            }
          }
        }
      } catch (error) {
        logger.error('Error applying remote operation:', error)
      } finally {
        isApplyingRemoteChange.current = false
      }
    }

    const handleSubblockUpdate = (data: any) => {
      const { workflowId, blockId, subblockId, value, userId } = data

      if (isApplyingRemoteChange.current) return

      // Filter broadcasts by workflowId to prevent cross-workflow updates
      if (workflowId && workflowId !== activeWorkflowId) {
        logger.debug('Ignoring subblock update for different workflow', {
          broadcastWorkflowId: workflowId,
          activeWorkflowId,
        })
        return
      }

      logger.info(`Received subblock update from user ${userId}: ${blockId}.${subblockId}`)

      isApplyingRemoteChange.current = true

      try {
        useSubBlockStore.getState().setValue(blockId, subblockId, value)
        const blockType = useWorkflowStore.getState().blocks?.[blockId]?.type
        if (activeWorkflowId && blockType === 'function' && subblockId === 'code') {
          useCodeUndoRedoStore.getState().clear(activeWorkflowId, blockId, subblockId)
        }
      } catch (error) {
        logger.error('Error applying remote subblock update:', error)
      } finally {
        isApplyingRemoteChange.current = false
      }
    }

    const handleVariableUpdate = (data: any) => {
      const { workflowId, variableId, field, value, userId } = data

      if (isApplyingRemoteChange.current) return

      // Filter broadcasts by workflowId to prevent cross-workflow updates
      if (workflowId && workflowId !== activeWorkflowId) {
        logger.debug('Ignoring variable update for different workflow', {
          broadcastWorkflowId: workflowId,
          activeWorkflowId,
        })
        return
      }

      logger.info(`Received variable update from user ${userId}: ${variableId}.${field}`)

      isApplyingRemoteChange.current = true

      try {
        if (field === 'name') {
          useVariablesStore.getState().updateVariable(variableId, { name: value })
        } else if (field === 'value') {
          useVariablesStore.getState().updateVariable(variableId, { value })
        } else if (field === 'type') {
          useVariablesStore.getState().updateVariable(variableId, { type: value })
        }
      } catch (error) {
        logger.error('Error applying remote variable update:', error)
      } finally {
        isApplyingRemoteChange.current = false
      }
    }

    const handleWorkflowDeleted = (data: any) => {
      const { workflowId } = data
      logger.warn(`Workflow ${workflowId} has been deleted`)

      if (activeWorkflowId === workflowId) {
        logger.info(
          `Currently active workflow ${workflowId} was deleted, stopping collaborative operations`
        )

        const currentUserId = session?.user?.id || 'unknown'
        useUndoRedoStore.getState().clear(workflowId, currentUserId)

        isApplyingRemoteChange.current = false
      }
    }

    const handleWorkflowReverted = async (data: any) => {
      const { workflowId } = data
      logger.info(`Workflow ${workflowId} has been reverted to deployed state`)

      // If the reverted workflow is the currently active one, reload the workflow state
      if (activeWorkflowId === workflowId) {
        logger.info(`Currently active workflow ${workflowId} was reverted, reloading state`)

        try {
          // Fetch the updated workflow state from the server (which loads from normalized tables)
          const response = await fetch(`/api/workflows/${workflowId}`)
          if (response.ok) {
            const responseData = await response.json()
            const workflowData = responseData.data

            if (workflowData?.state) {
              // Update the workflow store with the reverted state
              isApplyingRemoteChange.current = true
              try {
                // Update the main workflow state using the API response
                useWorkflowStore.setState({
                  blocks: workflowData.state.blocks || {},
                  edges: workflowData.state.edges || [],
                  loops: workflowData.state.loops || {},
                  parallels: workflowData.state.parallels || {},
                  lastSaved: workflowData.state.lastSaved || Date.now(),
                  deploymentStatuses: workflowData.state.deploymentStatuses || {},
                })

                // Update subblock store with reverted values
                const subblockValues: Record<string, Record<string, any>> = {}
                Object.entries(workflowData.state.blocks || {}).forEach(([blockId, block]) => {
                  const blockState = block as any
                  subblockValues[blockId] = {}
                  Object.entries(blockState.subBlocks || {}).forEach(([subblockId, subblock]) => {
                    subblockValues[blockId][subblockId] = (subblock as any).value
                  })
                })

                // Update subblock store for this workflow
                useSubBlockStore.setState((state: any) => ({
                  workflowValues: {
                    ...state.workflowValues,
                    [workflowId]: subblockValues,
                  },
                }))

                logger.info(`Successfully loaded reverted workflow state for ${workflowId}`)

                const graph = {
                  blocksById: workflowData.state.blocks || {},
                  edgesById: Object.fromEntries(
                    (workflowData.state.edges || []).map((e: any) => [e.id, e])
                  ),
                }

                const undoRedoStore = useUndoRedoStore.getState()
                const stackKeys = Object.keys(undoRedoStore.stacks)
                stackKeys.forEach((key) => {
                  const [wfId, userId] = key.split(':')
                  if (wfId === workflowId) {
                    undoRedoStore.pruneInvalidEntries(wfId, userId, graph)
                  }
                })
              } finally {
                isApplyingRemoteChange.current = false
              }
            } else {
              logger.error('No state found in workflow data after revert', { workflowData })
            }
          } else {
            logger.error(`Failed to fetch workflow data after revert: ${response.statusText}`)
          }
        } catch (error) {
          logger.error('Error reloading workflow state after revert:', error)
        }
      }
    }

    const handleOperationConfirmed = (data: any) => {
      const { operationId } = data
      logger.debug('Operation confirmed', { operationId })
      confirmOperation(operationId)
    }

    const handleOperationFailed = (data: any) => {
      const { operationId, error, retryable } = data
      logger.warn('Operation failed', { operationId, error, retryable })

      failOperation(operationId, retryable)
    }

    onWorkflowOperation(handleWorkflowOperation)
    onSubblockUpdate(handleSubblockUpdate)
    onVariableUpdate(handleVariableUpdate)
    onWorkflowDeleted(handleWorkflowDeleted)
    onWorkflowReverted(handleWorkflowReverted)
    onOperationConfirmed(handleOperationConfirmed)
    onOperationFailed(handleOperationFailed)
  }, [
    onWorkflowOperation,
    onSubblockUpdate,
    onVariableUpdate,
    onWorkflowDeleted,
    onWorkflowReverted,
    onOperationConfirmed,
    onOperationFailed,
    activeWorkflowId,
    confirmOperation,
    failOperation,
    emitWorkflowOperation,
  ])

  const executeQueuedOperation = useCallback(
    (operation: string, target: string, payload: any, localAction: () => void) => {
      if (isApplyingRemoteChange.current) {
        return
      }

      // Skip socket operations when viewing baseline diff (readonly)
      if (isBaselineDiffView) {
        logger.debug('Skipping socket operation while viewing baseline diff:', operation)
        return
      }

      // Queue operations if we have an active workflow - queue handles socket readiness
      if (!activeWorkflowId) {
        logger.debug('Skipping operation - no active workflow', { operation, target })
        return
      }

      const operationId = crypto.randomUUID()

      addToQueue({
        id: operationId,
        operation: {
          operation,
          target,
          payload,
        },
        workflowId: activeWorkflowId,
        userId: session?.user?.id || 'unknown',
      })

      localAction()
    },
    [addToQueue, session?.user?.id, isBaselineDiffView, activeWorkflowId]
  )

  const collaborativeBatchUpdatePositions = useCallback(
    (
      updates: Array<{ id: string; position: Position }>,
      options?: {
        previousPositions?: Map<string, { x: number; y: number; parentId?: string }>
      }
    ) => {
      if (isBaselineDiffView) {
        return
      }

      if (!activeWorkflowId) {
        logger.debug('Skipping batch position update - no active workflow')
        return
      }

      if (updates.length === 0) return

      const operationId = crypto.randomUUID()

      addToQueue({
        id: operationId,
        operation: {
          operation: BLOCKS_OPERATIONS.BATCH_UPDATE_POSITIONS,
          target: OPERATION_TARGETS.BLOCKS,
          payload: { updates },
        },
        workflowId: activeWorkflowId || '',
        userId: session?.user?.id || 'unknown',
      })

      useWorkflowStore.getState().batchUpdatePositions(updates)

      if (options?.previousPositions && options.previousPositions.size > 0) {
        const moves = updates
          .filter((u) => options.previousPositions!.has(u.id))
          .map((u) => {
            const prev = options.previousPositions!.get(u.id)!
            const block = useWorkflowStore.getState().blocks[u.id]
            return {
              blockId: u.id,
              before: prev,
              after: {
                x: u.position.x,
                y: u.position.y,
                parentId: block?.data?.parentId,
              },
            }
          })
          .filter((m) => m.before.x !== m.after.x || m.before.y !== m.after.y)

        if (moves.length > 0) {
          undoRedo.recordBatchMoveBlocks(moves)
        }
      }
    },
    [isBaselineDiffView, addToQueue, activeWorkflowId, session?.user?.id, undoRedo]
  )

  const collaborativeUpdateBlockName = useCallback(
    (id: string, name: string): { success: boolean; error?: string } => {
      const blocks = useWorkflowStore.getState().blocks
      const block = blocks[id]

      if (block) {
        const parentId = block.data?.parentId
        const isParentLocked = parentId ? blocks[parentId]?.locked : false
        if (block.locked || isParentLocked) {
          logger.error('Cannot rename locked block')
          useNotificationStore.getState().addNotification({
            level: 'info',
            message: 'Cannot rename locked blocks',
            workflowId: activeWorkflowId || undefined,
          })
          return { success: false, error: 'Block is locked' }
        }
      }

      const trimmedName = name.trim()
      const normalizedNewName = normalizeName(trimmedName)

      if (!normalizedNewName) {
        logger.error('Cannot rename block to empty name')
        useNotificationStore.getState().addNotification({
          level: 'error',
          message: 'Block name cannot be empty',
          workflowId: activeWorkflowId || undefined,
        })
        return { success: false, error: 'Block name cannot be empty' }
      }

      if ((RESERVED_BLOCK_NAMES as readonly string[]).includes(normalizedNewName)) {
        logger.error(`Cannot rename block to reserved name: "${trimmedName}"`)
        useNotificationStore.getState().addNotification({
          level: 'error',
          message: `"${trimmedName}" is a reserved name and cannot be used`,
          workflowId: activeWorkflowId || undefined,
        })
        return { success: false, error: `"${trimmedName}" is a reserved name` }
      }

      const currentBlocks = useWorkflowStore.getState().blocks
      const conflictingBlock = Object.entries(currentBlocks).find(
        ([blockId, block]) => blockId !== id && normalizeName(block.name) === normalizedNewName
      )

      if (conflictingBlock) {
        const conflictName = conflictingBlock[1].name
        logger.error(`Cannot rename block to "${trimmedName}" - conflicts with "${conflictName}"`)
        useNotificationStore.getState().addNotification({
          level: 'error',
          message: `Block name "${trimmedName}" already exists`,
          workflowId: activeWorkflowId || undefined,
        })
        return { success: false, error: `Block name "${trimmedName}" already exists` }
      }

      executeQueuedOperation(
        BLOCK_OPERATIONS.UPDATE_NAME,
        OPERATION_TARGETS.BLOCK,
        { id, name: trimmedName },
        () => {
          const result = useWorkflowStore.getState().updateBlockName(id, trimmedName)

          if (result.success && result.changedSubblocks.length > 0) {
            logger.info('Emitting cascaded subblock updates from block rename', {
              blockId: id,
              newName: trimmedName,
              updateCount: result.changedSubblocks.length,
            })

            result.changedSubblocks.forEach(
              ({
                blockId,
                subBlockId,
                newValue,
              }: {
                blockId: string
                subBlockId: string
                newValue: any
              }) => {
                const operationId = crypto.randomUUID()
                addToQueue({
                  id: operationId,
                  operation: {
                    operation: SUBBLOCK_OPERATIONS.UPDATE,
                    target: OPERATION_TARGETS.SUBBLOCK,
                    payload: { blockId, subblockId: subBlockId, value: newValue },
                  },
                  workflowId: activeWorkflowId || '',
                  userId: session?.user?.id || 'unknown',
                })
              }
            )
          }
        }
      )

      return { success: true }
    },
    [executeQueuedOperation, addToQueue, activeWorkflowId, session?.user?.id]
  )

  const collaborativeBatchToggleBlockEnabled = useCallback(
    (ids: string[]) => {
      if (isBaselineDiffView) {
        return
      }

      if (ids.length === 0) return

      const currentBlocks = useWorkflowStore.getState().blocks
      const previousStates: Record<string, boolean> = {}
      const validIds: string[] = []

      // For each ID, collect non-locked blocks and their children for undo/redo
      for (const id of ids) {
        const block = currentBlocks[id]
        if (!block) continue

        // Skip locked blocks
        if (block.locked) continue
        validIds.push(id)
        previousStates[id] = block.enabled

        // If it's a loop or parallel, also capture children's previous states for undo/redo
        if (block.type === 'loop' || block.type === 'parallel') {
          Object.entries(currentBlocks).forEach(([blockId, b]) => {
            if (b.data?.parentId === id && !b.locked) {
              previousStates[blockId] = b.enabled
            }
          })
        }
      }

      if (validIds.length === 0) return

      const operationId = crypto.randomUUID()

      addToQueue({
        id: operationId,
        operation: {
          operation: BLOCKS_OPERATIONS.BATCH_TOGGLE_ENABLED,
          target: OPERATION_TARGETS.BLOCKS,
          payload: { blockIds: validIds, previousStates },
        },
        workflowId: activeWorkflowId || '',
        userId: session?.user?.id || 'unknown',
      })

      useWorkflowStore.getState().batchToggleEnabled(validIds)

      undoRedo.recordBatchToggleEnabled(validIds, previousStates)
    },
    [isBaselineDiffView, addToQueue, activeWorkflowId, session?.user?.id, undoRedo]
  )

  const collaborativeBatchUpdateParent = useCallback(
    (
      updates: Array<{
        blockId: string
        newParentId: string | null
        newPosition: { x: number; y: number }
        affectedEdges: Edge[]
      }>
    ) => {
      if (isBaselineDiffView) {
        return
      }

      if (!activeWorkflowId) {
        logger.debug('Skipping batch update parent - no active workflow')
        return
      }

      if (updates.length === 0) return

      const batchUpdates = updates.map((u) => {
        const block = useWorkflowStore.getState().blocks[u.blockId]
        const oldParentId = block?.data?.parentId
        const oldPosition = block?.position || { x: 0, y: 0 }

        return {
          blockId: u.blockId,
          oldParentId,
          newParentId: u.newParentId || undefined,
          oldPosition,
          newPosition: u.newPosition,
          affectedEdges: u.affectedEdges,
        }
      })

      // Collect all edge IDs to remove
      const edgeIdsToRemove = updates.flatMap((u) => u.affectedEdges.map((e) => e.id))
      if (edgeIdsToRemove.length > 0) {
        const edgeOperationId = crypto.randomUUID()
        addToQueue({
          id: edgeOperationId,
          operation: {
            operation: EDGES_OPERATIONS.BATCH_REMOVE_EDGES,
            target: OPERATION_TARGETS.EDGES,
            payload: { ids: edgeIdsToRemove },
          },
          workflowId: activeWorkflowId || '',
          userId: session?.user?.id || 'unknown',
        })
        useWorkflowStore.getState().batchRemoveEdges(edgeIdsToRemove)
      }

      // Batch update positions and parents
      useWorkflowStore.getState().batchUpdateBlocksWithParent(
        updates.map((u) => ({
          id: u.blockId,
          position: u.newPosition,
          parentId: u.newParentId || undefined,
        }))
      )

      undoRedo.recordBatchUpdateParent(batchUpdates)

      const operationId = crypto.randomUUID()
      addToQueue({
        id: operationId,
        operation: {
          operation: BLOCKS_OPERATIONS.BATCH_UPDATE_PARENT,
          target: OPERATION_TARGETS.BLOCKS,
          payload: {
            updates: batchUpdates.map((u) => ({
              id: u.blockId,
              parentId: u.newParentId || '',
              position: u.newPosition,
            })),
          },
        },
        workflowId: activeWorkflowId || '',
        userId: session?.user?.id || 'unknown',
      })

      logger.debug('Batch updated parent for blocks', { updateCount: updates.length })
    },
    [isBaselineDiffView, undoRedo, addToQueue, activeWorkflowId, session?.user?.id]
  )

  const collaborativeToggleBlockAdvancedMode = useCallback(
    (id: string) => {
      const block = useWorkflowStore.getState().blocks[id]
      if (!block) return
      const newAdvancedMode = !block.advancedMode
      executeQueuedOperation(
        BLOCK_OPERATIONS.UPDATE_ADVANCED_MODE,
        OPERATION_TARGETS.BLOCK,
        { id, advancedMode: newAdvancedMode },
        () => useWorkflowStore.getState().setBlockAdvancedMode(id, newAdvancedMode)
      )
    },
    [executeQueuedOperation]
  )

  const collaborativeSetBlockCanonicalMode = useCallback(
    (id: string, canonicalId: string, canonicalMode: 'basic' | 'advanced') => {
      if (isBaselineDiffView) {
        return
      }

      useWorkflowStore.getState().setBlockCanonicalMode(id, canonicalId, canonicalMode)

      if (!activeWorkflowId) {
        return
      }

      const operationId = crypto.randomUUID()
      addToQueue({
        id: operationId,
        operation: {
          operation: BLOCK_OPERATIONS.UPDATE_CANONICAL_MODE,
          target: OPERATION_TARGETS.BLOCK,
          payload: { id, canonicalId, canonicalMode },
        },
        workflowId: activeWorkflowId,
        userId: session?.user?.id || 'unknown',
      })
    },
    [isBaselineDiffView, activeWorkflowId, addToQueue, session?.user?.id]
  )

  const collaborativeBatchToggleBlockHandles = useCallback(
    (ids: string[]) => {
      if (isBaselineDiffView) {
        return
      }

      if (ids.length === 0) return

      const blocks = useWorkflowStore.getState().blocks

      const isProtected = (blockId: string): boolean => {
        const block = blocks[blockId]
        if (!block) return false
        if (block.locked) return true
        const parentId = block.data?.parentId
        if (parentId && blocks[parentId]?.locked) return true
        return false
      }

      const previousStates: Record<string, boolean> = {}
      const validIds: string[] = []

      for (const id of ids) {
        const block = blocks[id]
        if (block && !isProtected(id)) {
          previousStates[id] = block.horizontalHandles ?? false
          validIds.push(id)
        }
      }

      if (validIds.length === 0) return

      const operationId = crypto.randomUUID()

      addToQueue({
        id: operationId,
        operation: {
          operation: BLOCKS_OPERATIONS.BATCH_TOGGLE_HANDLES,
          target: OPERATION_TARGETS.BLOCKS,
          payload: { blockIds: validIds, previousStates },
        },
        workflowId: activeWorkflowId || '',
        userId: session?.user?.id || 'unknown',
      })

      useWorkflowStore.getState().batchToggleHandles(validIds)

      undoRedo.recordBatchToggleHandles(validIds, previousStates)
    },
    [isBaselineDiffView, addToQueue, activeWorkflowId, session?.user?.id, undoRedo]
  )

  const collaborativeBatchToggleLocked = useCallback(
    (ids: string[]) => {
      if (isBaselineDiffView) {
        return
      }

      if (ids.length === 0) return

      const currentBlocks = useWorkflowStore.getState().blocks
      const previousStates: Record<string, boolean> = {}
      const validIds: string[] = []

      for (const id of ids) {
        const block = currentBlocks[id]
        if (!block) continue

        validIds.push(id)
        previousStates[id] = block.locked ?? false

        if (block.type === 'loop' || block.type === 'parallel') {
          Object.entries(currentBlocks).forEach(([blockId, b]) => {
            if (b.data?.parentId === id) {
              previousStates[blockId] = b.locked ?? false
            }
          })
        }
      }

      if (validIds.length === 0) return

      const operationId = crypto.randomUUID()

      addToQueue({
        id: operationId,
        operation: {
          operation: BLOCKS_OPERATIONS.BATCH_TOGGLE_LOCKED,
          target: OPERATION_TARGETS.BLOCKS,
          payload: { blockIds: validIds, previousStates },
        },
        workflowId: activeWorkflowId || '',
        userId: session?.user?.id || 'unknown',
      })

      useWorkflowStore.getState().batchToggleLocked(validIds)

      undoRedo.recordBatchToggleLocked(validIds, previousStates)
    },
    [isBaselineDiffView, addToQueue, activeWorkflowId, session?.user?.id, undoRedo]
  )

  const collaborativeBatchAddEdges = useCallback(
    (edges: Edge[], options?: { skipUndoRedo?: boolean }) => {
      if (isBaselineDiffView) {
        return false
      }

      if (!activeWorkflowId) {
        logger.debug('Skipping batch add edges - no active workflow')
        return false
      }

      if (edges.length === 0) return false

      const blocks = useWorkflowStore.getState().blocks
      const currentEdges = useWorkflowStore.getState().edges
      const validEdges = filterValidEdges(edges, blocks)
      const newEdges = filterNewEdges(validEdges, currentEdges)
      if (newEdges.length === 0) return false

      const operationId = crypto.randomUUID()

      addToQueue({
        id: operationId,
        operation: {
          operation: EDGES_OPERATIONS.BATCH_ADD_EDGES,
          target: OPERATION_TARGETS.EDGES,
          payload: { edges: newEdges },
        },
        workflowId: activeWorkflowId || '',
        userId: session?.user?.id || 'unknown',
      })

      useWorkflowStore.getState().batchAddEdges(newEdges, { skipValidation: true })

      if (!options?.skipUndoRedo) {
        newEdges.forEach((edge) => undoRedo.recordAddEdge(edge.id))
      }

      return true
    },
    [isBaselineDiffView, addToQueue, activeWorkflowId, session?.user?.id, undoRedo]
  )

  const collaborativeBatchRemoveEdges = useCallback(
    (edgeIds: string[], options?: { skipUndoRedo?: boolean }) => {
      if (isBaselineDiffView) {
        return false
      }

      if (!activeWorkflowId) {
        logger.debug('Skipping batch remove edges - no active workflow')
        return false
      }

      if (edgeIds.length === 0) return false

      const edgeSnapshots: Edge[] = []
      const validEdgeIds: string[] = []

      for (const edgeId of edgeIds) {
        const edge = useWorkflowStore.getState().edges.find((e) => e.id === edgeId)
        if (edge) {
          const sourceExists = useWorkflowStore.getState().blocks[edge.source]
          const targetExists = useWorkflowStore.getState().blocks[edge.target]
          if (sourceExists && targetExists) {
            edgeSnapshots.push(edge)
            validEdgeIds.push(edgeId)
          }
        }
      }

      if (validEdgeIds.length === 0) {
        logger.debug('No valid edges to remove')
        return false
      }

      const operationId = crypto.randomUUID()

      addToQueue({
        id: operationId,
        operation: {
          operation: EDGES_OPERATIONS.BATCH_REMOVE_EDGES,
          target: OPERATION_TARGETS.EDGES,
          payload: { ids: validEdgeIds },
        },
        workflowId: activeWorkflowId || '',
        userId: session?.user?.id || 'unknown',
      })

      useWorkflowStore.getState().batchRemoveEdges(validEdgeIds)

      if (!options?.skipUndoRedo && edgeSnapshots.length > 0) {
        undoRedo.recordBatchRemoveEdges(edgeSnapshots)
      }

      logger.info('Batch removed edges', { count: validEdgeIds.length })
      return true
    },
    [isBaselineDiffView, addToQueue, activeWorkflowId, session, undoRedo]
  )

  const collaborativeSetSubblockValue = useCallback(
    (blockId: string, subblockId: string, value: any, options?: { _visited?: Set<string> }) => {
      if (isApplyingRemoteChange.current) return

      if (isBaselineDiffView) {
        logger.debug('Skipping collaborative subblock update while viewing baseline diff')
        return
      }

      // ALWAYS update local store first for immediate UI feedback
      useSubBlockStore.getState().setValue(blockId, subblockId, value)

      // Handle dependent subblock clearing (recursive calls)
      try {
        const visited = options?._visited || new Set<string>()
        if (visited.has(subblockId)) return
        visited.add(subblockId)
        const blockType = useWorkflowStore.getState().blocks?.[blockId]?.type
        const blockConfig = blockType ? getBlock(blockType) : null
        if (blockConfig?.subBlocks && Array.isArray(blockConfig.subBlocks)) {
          const dependents = blockConfig.subBlocks.filter(
            (sb: any) => Array.isArray(sb.dependsOn) && sb.dependsOn.includes(subblockId)
          )
          for (const dep of dependents) {
            if (!dep?.id || dep.id === subblockId) continue
            collaborativeSetSubblockValue(blockId, dep.id, '', { _visited: visited })
          }
        }
      } catch {
        // Best-effort; do not block on clearing
      }

      // Queue socket operation if we have an active workflow
      if (!activeWorkflowId) {
        logger.debug('Local update applied, skipping socket queue - no active workflow', {
          blockId,
          subblockId,
        })
        return
      }

      const operationId = crypto.randomUUID()

      addToQueue({
        id: operationId,
        operation: {
          operation: SUBBLOCK_OPERATIONS.UPDATE,
          target: OPERATION_TARGETS.SUBBLOCK,
          payload: { blockId, subblockId, value },
        },
        workflowId: activeWorkflowId,
        userId: session?.user?.id || 'unknown',
      })
    },
    [activeWorkflowId, addToQueue, session?.user?.id, isBaselineDiffView]
  )

  // Immediate tag selection (uses queue but processes immediately, no debouncing)
  const collaborativeSetTagSelection = useCallback(
    (blockId: string, subblockId: string, value: any) => {
      if (isApplyingRemoteChange.current) return

      if (isBaselineDiffView) {
        return
      }

      if (!activeWorkflowId) {
        logger.debug('Skipping tag selection - no active workflow', { blockId, subblockId })
        return
      }

      // Apply locally first (immediate UI feedback)
      useSubBlockStore.getState().setValue(blockId, subblockId, value)

      // Use the operation queue but with immediate processing (no debouncing)
      const operationId = crypto.randomUUID()

      addToQueue({
        id: operationId,
        operation: {
          operation: SUBBLOCK_OPERATIONS.UPDATE,
          target: OPERATION_TARGETS.SUBBLOCK,
          payload: { blockId, subblockId, value },
        },
        workflowId: activeWorkflowId || '',
        userId: session?.user?.id || 'unknown',
      })
    },
    [isBaselineDiffView, addToQueue, activeWorkflowId, session?.user?.id]
  )

  const collaborativeUpdateLoopType = useCallback(
    (loopId: string, loopType: 'for' | 'forEach' | 'while' | 'doWhile') => {
      const currentBlock = useWorkflowStore.getState().blocks[loopId]
      if (!currentBlock || currentBlock.type !== 'loop') return

      const childNodes = Object.values(useWorkflowStore.getState().blocks)
        .filter((b) => b.data?.parentId === loopId)
        .map((b) => b.id)

      const currentIterations = currentBlock.data?.count || 5
      const currentCollection = currentBlock.data?.collection || ''

      const existingLoop = useWorkflowStore.getState().loops[loopId]
      const existingForEachItems = existingLoop?.forEachItems ?? currentCollection ?? ''
      const existingWhileCondition =
        existingLoop?.whileCondition ?? currentBlock.data?.whileCondition ?? ''
      const existingDoWhileCondition =
        existingLoop?.doWhileCondition ?? currentBlock.data?.doWhileCondition ?? ''

      const config: any = {
        id: loopId,
        nodes: childNodes,
        iterations: currentIterations,
        loopType,
        forEachItems: existingForEachItems ?? '',
        whileCondition: existingWhileCondition ?? '',
        doWhileCondition: existingDoWhileCondition ?? '',
      }

      executeQueuedOperation(
        SUBFLOW_OPERATIONS.UPDATE,
        OPERATION_TARGETS.SUBFLOW,
        { id: loopId, type: 'loop', config },
        () => {
          useWorkflowStore.getState().updateLoopType(loopId, loopType)
          useWorkflowStore.getState().setLoopForEachItems(loopId, existingForEachItems ?? '')
          useWorkflowStore.getState().setLoopWhileCondition(loopId, existingWhileCondition ?? '')
          useWorkflowStore
            .getState()
            .setLoopDoWhileCondition(loopId, existingDoWhileCondition ?? '')
        }
      )
    },
    [executeQueuedOperation]
  )

  const collaborativeUpdateParallelType = useCallback(
    (parallelId: string, parallelType: 'count' | 'collection') => {
      const currentBlock = useWorkflowStore.getState().blocks[parallelId]
      if (!currentBlock || currentBlock.type !== 'parallel') return

      const childNodes = Object.values(useWorkflowStore.getState().blocks)
        .filter((b) => b.data?.parentId === parallelId)
        .map((b) => b.id)

      let newCount = currentBlock.data?.count || 5
      let newDistribution = currentBlock.data?.collection || ''

      if (parallelType === 'count') {
        newDistribution = ''
      } else {
        newCount = 1
        newDistribution = newDistribution || ''
      }

      const config = {
        id: parallelId,
        nodes: childNodes,
        count: newCount,
        distribution: newDistribution,
        parallelType,
      }

      executeQueuedOperation(
        SUBFLOW_OPERATIONS.UPDATE,
        OPERATION_TARGETS.SUBFLOW,
        { id: parallelId, type: 'parallel', config },
        () => {
          useWorkflowStore.getState().updateParallelType(parallelId, parallelType)
          useWorkflowStore.getState().updateParallelCount(parallelId, newCount)
          useWorkflowStore.getState().updateParallelCollection(parallelId, newDistribution)
        }
      )
    },
    [executeQueuedOperation]
  )

  // Unified iteration management functions - count and collection only
  const collaborativeUpdateIterationCount = useCallback(
    (nodeId: string, iterationType: 'loop' | 'parallel', count: number) => {
      const currentBlock = useWorkflowStore.getState().blocks[nodeId]
      if (!currentBlock || currentBlock.type !== iterationType) return

      const childNodes = Object.values(useWorkflowStore.getState().blocks)
        .filter((b) => b.data?.parentId === nodeId)
        .map((b) => b.id)

      if (iterationType === 'loop') {
        const currentLoopType = currentBlock.data?.loopType || 'for'
        const currentCollection = currentBlock.data?.collection || ''

        const config = {
          id: nodeId,
          nodes: childNodes,
          iterations: Math.max(1, Math.min(1000, count)), // Clamp between 1-1000 for loops
          loopType: currentLoopType,
          forEachItems: currentCollection,
        }

        executeQueuedOperation(
          SUBFLOW_OPERATIONS.UPDATE,
          OPERATION_TARGETS.SUBFLOW,
          { id: nodeId, type: 'loop', config },
          () => useWorkflowStore.getState().updateLoopCount(nodeId, count)
        )
      } else {
        const currentDistribution = currentBlock.data?.collection || ''
        const currentParallelType = currentBlock.data?.parallelType || 'count'

        const config = {
          id: nodeId,
          nodes: childNodes,
          count: Math.max(1, Math.min(20, count)), // Clamp between 1-20 for parallels
          distribution: currentDistribution,
          parallelType: currentParallelType,
        }

        executeQueuedOperation(
          SUBFLOW_OPERATIONS.UPDATE,
          OPERATION_TARGETS.SUBFLOW,
          { id: nodeId, type: 'parallel', config },
          () => useWorkflowStore.getState().updateParallelCount(nodeId, count)
        )
      }
    },
    [executeQueuedOperation]
  )

  const collaborativeUpdateIterationCollection = useCallback(
    (nodeId: string, iterationType: 'loop' | 'parallel', collection: string) => {
      const currentBlock = useWorkflowStore.getState().blocks[nodeId]
      if (!currentBlock || currentBlock.type !== iterationType) return

      const childNodes = Object.values(useWorkflowStore.getState().blocks)
        .filter((b) => b.data?.parentId === nodeId)
        .map((b) => b.id)

      if (iterationType === 'loop') {
        const currentIterations = currentBlock.data?.count || 5
        const currentLoopType = currentBlock.data?.loopType || 'for'

        const existingLoop = useWorkflowStore.getState().loops[nodeId]
        let nextForEachItems = existingLoop?.forEachItems ?? currentBlock.data?.collection ?? ''
        let nextWhileCondition =
          existingLoop?.whileCondition ?? currentBlock.data?.whileCondition ?? ''
        let nextDoWhileCondition =
          existingLoop?.doWhileCondition ?? currentBlock.data?.doWhileCondition ?? ''

        if (currentLoopType === 'forEach') {
          nextForEachItems = collection
        } else if (currentLoopType === 'while') {
          nextWhileCondition = collection
        } else if (currentLoopType === 'doWhile') {
          nextDoWhileCondition = collection
        }

        const config: any = {
          id: nodeId,
          nodes: childNodes,
          iterations: currentIterations,
          loopType: currentLoopType,
          forEachItems: nextForEachItems ?? '',
          whileCondition: nextWhileCondition ?? '',
          doWhileCondition: nextDoWhileCondition ?? '',
        }

        executeQueuedOperation(
          SUBFLOW_OPERATIONS.UPDATE,
          OPERATION_TARGETS.SUBFLOW,
          { id: nodeId, type: 'loop', config },
          () => {
            useWorkflowStore.getState().setLoopForEachItems(nodeId, nextForEachItems ?? '')
            useWorkflowStore.getState().setLoopWhileCondition(nodeId, nextWhileCondition ?? '')
            useWorkflowStore.getState().setLoopDoWhileCondition(nodeId, nextDoWhileCondition ?? '')
          }
        )
      } else {
        const currentCount = currentBlock.data?.count || 5
        const currentParallelType = currentBlock.data?.parallelType || 'count'

        const config = {
          id: nodeId,
          nodes: childNodes,
          count: currentCount,
          distribution: collection,
          parallelType: currentParallelType,
        }

        executeQueuedOperation(
          SUBFLOW_OPERATIONS.UPDATE,
          OPERATION_TARGETS.SUBFLOW,
          { id: nodeId, type: 'parallel', config },
          () => useWorkflowStore.getState().updateParallelCollection(nodeId, collection)
        )
      }
    },
    [executeQueuedOperation]
  )

  const collaborativeUpdateVariable = useCallback(
    (variableId: string, field: 'name' | 'value' | 'type', value: any) => {
      executeQueuedOperation(
        VARIABLE_OPERATIONS.UPDATE,
        OPERATION_TARGETS.VARIABLE,
        { variableId, field, value },
        () => {
          if (field === 'name') {
            useVariablesStore.getState().updateVariable(variableId, { name: value })
          } else if (field === 'value') {
            useVariablesStore.getState().updateVariable(variableId, { value })
          } else if (field === 'type') {
            useVariablesStore.getState().updateVariable(variableId, { type: value })
          }
        }
      )
    },
    [executeQueuedOperation]
  )

  const collaborativeAddVariable = useCallback(
    (variableData: { name: string; type: any; value: any; workflowId: string }) => {
      const id = crypto.randomUUID()

      // Optimistically add to local store first
      useVariablesStore.getState().addVariable(variableData, id)
      const processedVariable = useVariablesStore.getState().variables[id]

      if (processedVariable) {
        const payloadWithProcessedName = {
          ...variableData,
          id,
          name: processedVariable.name,
        }

        // Queue operation with processed name for server & other clients
        // Empty callback because local store is already updated above
        executeQueuedOperation(
          VARIABLE_OPERATIONS.ADD,
          OPERATION_TARGETS.VARIABLE,
          payloadWithProcessedName,
          () => {}
        )
      }

      return id
    },
    [executeQueuedOperation]
  )

  const collaborativeDeleteVariable = useCallback(
    (variableId: string) => {
      cancelOperationsForVariable(variableId)

      executeQueuedOperation(
        VARIABLE_OPERATIONS.REMOVE,
        OPERATION_TARGETS.VARIABLE,
        { variableId },
        () => {
          useVariablesStore.getState().deleteVariable(variableId)
        }
      )
    },
    [executeQueuedOperation, cancelOperationsForVariable]
  )

  const collaborativeBatchAddBlocks = useCallback(
    (
      blocks: BlockState[],
      edges: Edge[] = [],
      loops: Record<string, Loop> = {},
      parallels: Record<string, Parallel> = {},
      subBlockValues: Record<string, Record<string, unknown>> = {},
      options?: { skipUndoRedo?: boolean }
    ) => {
      if (!activeWorkflowId) {
        logger.debug('Skipping batch add blocks - no active workflow')
        return false
      }

      if (isBaselineDiffView) {
        logger.debug('Skipping batch add blocks while viewing baseline diff')
        return false
      }

      if (blocks.length === 0) return false

      // Filter out invalid edges (e.g., edges targeting trigger blocks)
      // Combine existing blocks with new blocks for validation
      const existingBlocks = useWorkflowStore.getState().blocks
      const newBlocksMap = blocks.reduce(
        (acc, block) => {
          acc[block.id] = block
          return acc
        },
        {} as Record<string, BlockState>
      )
      const allBlocks = { ...existingBlocks, ...newBlocksMap }
      const validEdges = filterValidEdges(edges, allBlocks)

      logger.info('Batch adding blocks collaboratively', {
        blockCount: blocks.length,
        edgeCount: validEdges.length,
        filteredEdges: edges.length - validEdges.length,
      })

      const operationId = crypto.randomUUID()

      addToQueue({
        id: operationId,
        operation: {
          operation: BLOCKS_OPERATIONS.BATCH_ADD_BLOCKS,
          target: OPERATION_TARGETS.BLOCKS,
          payload: { blocks, edges: validEdges, loops, parallels, subBlockValues },
        },
        workflowId: activeWorkflowId || '',
        userId: session?.user?.id || 'unknown',
      })

      useWorkflowStore.getState().batchAddBlocks(blocks, validEdges, subBlockValues, {
        skipEdgeValidation: true,
      })

      if (!options?.skipUndoRedo) {
        undoRedo.recordBatchAddBlocks(blocks, validEdges, subBlockValues)
      }

      return true
    },
    [addToQueue, activeWorkflowId, session?.user?.id, isBaselineDiffView, undoRedo]
  )

  const collaborativeBatchRemoveBlocks = useCallback(
    (blockIds: string[], options?: { skipUndoRedo?: boolean }) => {
      if (isBaselineDiffView) {
        return false
      }

      if (!activeWorkflowId) {
        logger.debug('Skipping batch remove blocks - no active workflow')
        return false
      }

      if (blockIds.length === 0) return false

      blockIds.forEach((id) => cancelOperationsForBlock(id))

      const allBlocksToRemove = new Set<string>(blockIds)
      const findAllDescendants = (parentId: string) => {
        Object.entries(useWorkflowStore.getState().blocks).forEach(([blockId, block]) => {
          if (block.data?.parentId === parentId) {
            allBlocksToRemove.add(blockId)
            findAllDescendants(blockId)
          }
        })
      }
      blockIds.forEach((id) => findAllDescendants(id))

      const currentEditedBlockId = usePanelEditorStore.getState().currentBlockId
      if (currentEditedBlockId && allBlocksToRemove.has(currentEditedBlockId)) {
        usePanelEditorStore.getState().clearCurrentBlock()
      }

      const mergedBlocks = mergeSubblockState(
        useWorkflowStore.getState().blocks,
        activeWorkflowId || undefined
      )
      const blockSnapshots: BlockState[] = []
      const subBlockValues: Record<string, Record<string, unknown>> = {}

      allBlocksToRemove.forEach((blockId) => {
        const block = mergedBlocks[blockId]
        if (block) {
          blockSnapshots.push(block)
          if (block.subBlocks) {
            const values: Record<string, unknown> = {}
            Object.entries(block.subBlocks).forEach(([subBlockId, subBlock]) => {
              if (subBlock.value !== null && subBlock.value !== undefined) {
                values[subBlockId] = subBlock.value
              }
            })
            if (Object.keys(values).length > 0) {
              subBlockValues[blockId] = values
            }
          }
        }
      })

      const edgeSnapshots = useWorkflowStore
        .getState()
        .edges.filter((e) => allBlocksToRemove.has(e.source) || allBlocksToRemove.has(e.target))

      logger.info('Batch removing blocks collaboratively', {
        requestedCount: blockIds.length,
        totalCount: allBlocksToRemove.size,
      })

      const operationId = crypto.randomUUID()

      addToQueue({
        id: operationId,
        operation: {
          operation: BLOCKS_OPERATIONS.BATCH_REMOVE_BLOCKS,
          target: OPERATION_TARGETS.BLOCKS,
          payload: { ids: Array.from(allBlocksToRemove) },
        },
        workflowId: activeWorkflowId || '',
        userId: session?.user?.id || 'unknown',
      })

      useWorkflowStore.getState().batchRemoveBlocks(blockIds)

      if (!options?.skipUndoRedo && blockSnapshots.length > 0) {
        undoRedo.recordBatchRemoveBlocks(blockSnapshots, edgeSnapshots, subBlockValues)
      }

      return true
    },
    [
      isBaselineDiffView,
      addToQueue,
      activeWorkflowId,
      session?.user?.id,
      cancelOperationsForBlock,
      undoRedo,
    ]
  )

  return {
    isConnected,
    currentWorkflowId,

    // Collaborative operations
    collaborativeBatchUpdatePositions,
    collaborativeUpdateBlockName,
    collaborativeBatchToggleBlockEnabled,
    collaborativeBatchUpdateParent,
    collaborativeToggleBlockAdvancedMode,
    collaborativeSetBlockCanonicalMode,
    collaborativeBatchToggleBlockHandles,
    collaborativeBatchToggleLocked,
    collaborativeBatchAddBlocks,
    collaborativeBatchRemoveBlocks,
    collaborativeBatchAddEdges,
    collaborativeBatchRemoveEdges,
    collaborativeSetSubblockValue,
    collaborativeSetTagSelection,

    // Collaborative variable operations
    collaborativeUpdateVariable,
    collaborativeAddVariable,
    collaborativeDeleteVariable,

    // Collaborative loop/parallel operations
    collaborativeUpdateLoopType,
    collaborativeUpdateParallelType,

    // Unified iteration operations
    collaborativeUpdateIterationCount,
    collaborativeUpdateIterationCollection,

    // Undo/Redo operations (wrapped to prevent recording moves during undo/redo)
    undo: useCallback(async () => {
      isUndoRedoInProgress.current = true
      await undoRedo.undo()
      // Use a longer delay to ensure all async operations complete
      setTimeout(() => {
        isUndoRedoInProgress.current = false
      }, 100)
    }, [undoRedo]),
    redo: useCallback(async () => {
      isUndoRedoInProgress.current = true
      await undoRedo.redo()
      // Use a longer delay to ensure all async operations complete
      setTimeout(() => {
        isUndoRedoInProgress.current = false
      }, 100)
    }, [undoRedo]),
    getUndoRedoSizes: undoRedo.getStackSizes,
    clearUndoRedo: undoRedo.clearStacks,
  }
}
