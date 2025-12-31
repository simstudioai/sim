import { useCallback, useEffect, useRef } from 'react'
import { createLogger } from '@sim/logger'
import type { Edge } from 'reactflow'
import { useSession } from '@/lib/auth/auth-client'
import { TriggerUtils } from '@/lib/workflows/triggers/triggers'
import { useSocket } from '@/app/workspace/providers/socket-provider'
import { getBlock } from '@/blocks'
import { useUndoRedo } from '@/hooks/use-undo-redo'
import { useNotificationStore } from '@/stores/notifications'
import { registerEmitFunctions, useOperationQueue } from '@/stores/operation-queue/store'
import { usePanelEditorStore } from '@/stores/panel/editor/store'
import { useVariablesStore } from '@/stores/panel/variables/store'
import { useUndoRedoStore } from '@/stores/undo-redo'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { mergeSubblockState, normalizeName } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { BlockState, Loop, Parallel, Position } from '@/stores/workflows/workflow/types'

const logger = createLogger('CollaborativeWorkflow')

const WEBHOOK_SUBBLOCK_FIELDS = ['webhookId', 'triggerPath']

export function useCollaborativeWorkflow() {
  const undoRedo = useUndoRedo()
  const isUndoRedoInProgress = useRef(false)
  const skipEdgeRecording = useRef(false)
  const lastDiffOperationId = useRef<string | null>(null)

  useEffect(() => {
    const moveHandler = (e: any) => {
      const { blockId, before, after } = e.detail || {}
      if (!blockId || !before || !after) return
      if (isUndoRedoInProgress.current) return
      undoRedo.recordMove(blockId, before, after)
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

    const skipEdgeHandler = (e: any) => {
      const { skip } = e.detail || {}
      skipEdgeRecording.current = skip
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
    window.addEventListener('skip-edge-recording', skipEdgeHandler)
    window.addEventListener('record-diff-operation', diffOperationHandler)
    return () => {
      window.removeEventListener('workflow-record-move', moveHandler)
      window.removeEventListener('workflow-record-parent-update', parentUpdateHandler)
      window.removeEventListener('skip-edge-recording', skipEdgeHandler)
      window.removeEventListener('record-diff-operation', diffOperationHandler)
    }
  }, [undoRedo])
  const {
    isConnected,
    currentWorkflowId,
    presenceUsers,
    joinWorkflow,
    leaveWorkflow,
    emitWorkflowOperation,
    emitSubblockUpdate,
    emitVariableUpdate,
    onWorkflowOperation,
    onSubblockUpdate,
    onVariableUpdate,
    onUserJoined,
    onUserLeft,
    onWorkflowDeleted,
    onWorkflowReverted,
    onOperationConfirmed,
    onOperationFailed,
  } = useSocket()

  const { activeWorkflowId } = useWorkflowRegistry()
  const workflowStore = useWorkflowStore()
  const subBlockStore = useSubBlockStore()
  const variablesStore = useVariablesStore()
  const { data: session } = useSession()
  const { hasActiveDiff, isShowingDiff } = useWorkflowDiffStore()
  const isBaselineDiffView = hasActiveDiff && !isShowingDiff

  // Track if we're applying remote changes to avoid infinite loops
  const isApplyingRemoteChange = useRef(false)

  // Track last applied position timestamps to prevent out-of-order updates
  const lastPositionTimestamps = useRef<Map<string, number>>(new Map())

  // Operation queue
  const {
    queue,
    hasOperationError,
    addToQueue,
    confirmOperation,
    failOperation,
    cancelOperationsForBlock,
    cancelOperationsForVariable,
  } = useOperationQueue()

  const isInActiveRoom = useCallback(() => {
    return !!currentWorkflowId && activeWorkflowId === currentWorkflowId
  }, [currentWorkflowId, activeWorkflowId])

  // Clear position timestamps when switching workflows
  // Note: Workflow joining is now handled automatically by socket connect event based on URL
  useEffect(() => {
    if (activeWorkflowId && currentWorkflowId !== activeWorkflowId) {
      logger.info(`Active workflow changed to: ${activeWorkflowId}`, {
        isConnected,
        currentWorkflowId,
        activeWorkflowId,
        presenceUsers: presenceUsers.length,
      })

      // Clear position timestamps when switching workflows
      lastPositionTimestamps.current.clear()
    }
  }, [activeWorkflowId, isConnected, currentWorkflowId])

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
      const { operation, target, payload, userId } = data

      if (isApplyingRemoteChange.current) return

      logger.info(`Received ${operation} on ${target} from user ${userId}`)

      // Apply the operation to local state
      isApplyingRemoteChange.current = true

      try {
        if (target === 'block') {
          switch (operation) {
            case 'update-position': {
              const blockId = payload.id

              if (!data.timestamp) {
                logger.warn('Position update missing timestamp, applying without ordering check', {
                  blockId,
                })
                workflowStore.updateBlockPosition(payload.id, payload.position)
                break
              }

              const updateTimestamp = data.timestamp
              const lastTimestamp = lastPositionTimestamps.current.get(blockId) || 0

              if (updateTimestamp >= lastTimestamp) {
                workflowStore.updateBlockPosition(payload.id, payload.position)
                lastPositionTimestamps.current.set(blockId, updateTimestamp)
              } else {
                // Skip out-of-order position update to prevent jagged movement
                logger.debug('Skipping out-of-order position update', {
                  blockId,
                  updateTimestamp,
                  lastTimestamp,
                  position: payload.position,
                })
              }
              break
            }
            case 'update-name':
              workflowStore.updateBlockName(payload.id, payload.name)
              break
            case 'toggle-enabled':
              workflowStore.toggleBlockEnabled(payload.id)
              break
            case 'update-parent':
              workflowStore.updateParentId(payload.id, payload.parentId, payload.extent)
              break
            case 'update-advanced-mode':
              workflowStore.setBlockAdvancedMode(payload.id, payload.advancedMode)
              break
            case 'update-trigger-mode':
              workflowStore.setBlockTriggerMode(payload.id, payload.triggerMode)
              break
            case 'toggle-handles': {
              const currentBlock = workflowStore.blocks[payload.id]
              if (currentBlock && currentBlock.horizontalHandles !== payload.horizontalHandles) {
                workflowStore.toggleBlockHandles(payload.id)
              }
              break
            }
          }
        } else if (target === 'blocks') {
          switch (operation) {
            case 'batch-update-positions': {
              const { updates } = payload
              if (Array.isArray(updates)) {
                updates.forEach(({ id, position }: { id: string; position: Position }) => {
                  if (id && position) {
                    workflowStore.updateBlockPosition(id, position)
                  }
                })
              }
              break
            }
          }
        } else if (target === 'edge') {
          switch (operation) {
            case 'add':
              workflowStore.addEdge(payload as Edge)
              break
            case 'remove': {
              workflowStore.removeEdge(payload.id)

              const updatedBlocks = useWorkflowStore.getState().blocks
              const updatedEdges = useWorkflowStore.getState().edges
              const graph = {
                blocksById: updatedBlocks,
                edgesById: Object.fromEntries(updatedEdges.map((e) => [e.id, e])),
              }

              const undoRedoStore = useUndoRedoStore.getState()
              const stackKeys = Object.keys(undoRedoStore.stacks)
              stackKeys.forEach((key) => {
                const [workflowId, userId] = key.split(':')
                if (workflowId === activeWorkflowId) {
                  undoRedoStore.pruneInvalidEntries(workflowId, userId, graph)
                }
              })
              break
            }
          }
        } else if (target === 'subflow') {
          switch (operation) {
            case 'update':
              // Handle subflow configuration updates (loop/parallel type changes, etc.)
              if (payload.type === 'loop') {
                const { config } = payload
                if (config.loopType !== undefined) {
                  workflowStore.updateLoopType(payload.id, config.loopType)
                }
                if (config.iterations !== undefined) {
                  workflowStore.updateLoopCount(payload.id, config.iterations)
                }
                if (config.forEachItems !== undefined) {
                  workflowStore.setLoopForEachItems(payload.id, config.forEachItems)
                }
                if (config.whileCondition !== undefined) {
                  workflowStore.setLoopWhileCondition(payload.id, config.whileCondition)
                }
                if (config.doWhileCondition !== undefined) {
                  workflowStore.setLoopDoWhileCondition(payload.id, config.doWhileCondition)
                }
              } else if (payload.type === 'parallel') {
                const { config } = payload
                if (config.parallelType !== undefined) {
                  workflowStore.updateParallelType(payload.id, config.parallelType)
                }
                if (config.count !== undefined) {
                  workflowStore.updateParallelCount(payload.id, config.count)
                }
                if (config.distribution !== undefined) {
                  workflowStore.updateParallelCollection(payload.id, config.distribution)
                }
              }
              break
          }
        } else if (target === 'variable') {
          switch (operation) {
            case 'add':
              variablesStore.addVariable(
                {
                  workflowId: payload.workflowId,
                  name: payload.name,
                  type: payload.type,
                  value: payload.value,
                },
                payload.id
              )
              break
            case 'variable-update':
              if (payload.field === 'name') {
                variablesStore.updateVariable(payload.variableId, { name: payload.value })
              } else if (payload.field === 'value') {
                variablesStore.updateVariable(payload.variableId, { value: payload.value })
              } else if (payload.field === 'type') {
                variablesStore.updateVariable(payload.variableId, { type: payload.value })
              }
              break
            case 'remove':
              variablesStore.deleteVariable(payload.variableId)
              break
          }
        } else if (target === 'workflow') {
          switch (operation) {
            case 'replace-state':
              if (payload.state) {
                logger.info('Received workflow state replacement from remote user', {
                  userId,
                  blockCount: Object.keys(payload.state.blocks || {}).length,
                  edgeCount: (payload.state.edges || []).length,
                  hasActiveDiff,
                  isShowingDiff,
                })
                workflowStore.replaceWorkflowState(payload.state)

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
                  subBlockStore.setWorkflowValues(activeWorkflowId, subBlockValues)
                }

                logger.info('Successfully applied remote workflow state replacement')
              }
              break
          }
        }

        if (target === 'blocks') {
          switch (operation) {
            case 'batch-add-blocks': {
              const {
                blocks,
                edges,
                loops,
                parallels,
                subBlockValues: addedSubBlockValues,
              } = payload
              logger.info('Received batch-add-blocks from remote user', {
                userId,
                blockCount: (blocks || []).length,
                edgeCount: (edges || []).length,
              })

              ;(blocks || []).forEach((block: BlockState) => {
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
                    triggerMode: block.triggerMode ?? false,
                    height: block.height,
                  }
                )
              })

              ;(edges || []).forEach((edge: Edge) => {
                workflowStore.addEdge(edge)
              })

              if (loops) {
                Object.entries(loops as Record<string, Loop>).forEach(([loopId, loopConfig]) => {
                  useWorkflowStore.setState((state) => ({
                    loops: { ...state.loops, [loopId]: loopConfig },
                  }))
                })
              }

              if (parallels) {
                Object.entries(parallels as Record<string, Parallel>).forEach(
                  ([parallelId, parallelConfig]) => {
                    useWorkflowStore.setState((state) => ({
                      parallels: { ...state.parallels, [parallelId]: parallelConfig },
                    }))
                  }
                )
              }

              if (addedSubBlockValues && activeWorkflowId) {
                Object.entries(
                  addedSubBlockValues as Record<string, Record<string, unknown>>
                ).forEach(([blockId, subBlocks]) => {
                  Object.entries(subBlocks).forEach(([subBlockId, value]) => {
                    subBlockStore.setValue(blockId, subBlockId, value)
                  })
                })
              }

              logger.info('Successfully applied batch-add-blocks from remote user')
              break
            }
            case 'batch-remove-blocks': {
              const { ids } = payload
              logger.info('Received batch-remove-blocks from remote user', {
                userId,
                count: (ids || []).length,
              })

              ;(ids || []).forEach((id: string) => {
                workflowStore.removeBlock(id)
              })

              logger.info('Successfully applied batch-remove-blocks from remote user')
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
      const { blockId, subblockId, value, userId } = data

      if (isApplyingRemoteChange.current) return

      logger.info(`Received subblock update from user ${userId}: ${blockId}.${subblockId}`)

      isApplyingRemoteChange.current = true

      try {
        // The setValue function automatically uses the active workflow ID
        subBlockStore.setValue(blockId, subblockId, value)
      } catch (error) {
        logger.error('Error applying remote subblock update:', error)
      } finally {
        isApplyingRemoteChange.current = false
      }
    }

    const handleVariableUpdate = (data: any) => {
      const { variableId, field, value, userId } = data

      if (isApplyingRemoteChange.current) return

      logger.info(`Received variable update from user ${userId}: ${variableId}.${field}`)

      isApplyingRemoteChange.current = true

      try {
        if (field === 'name') {
          variablesStore.updateVariable(variableId, { name: value })
        } else if (field === 'value') {
          variablesStore.updateVariable(variableId, { value })
        } else if (field === 'type') {
          variablesStore.updateVariable(variableId, { type: value })
        }
      } catch (error) {
        logger.error('Error applying remote variable update:', error)
      } finally {
        isApplyingRemoteChange.current = false
      }
    }

    const handleUserJoined = (data: any) => {
      logger.info(`User joined: ${data.userName}`)
    }

    const handleUserLeft = (data: any) => {
      logger.info(`User left: ${data.userId}`)
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
                  isDeployed: workflowData.state.isDeployed || false,
                  deployedAt: workflowData.state.deployedAt,
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

    // Register event handlers
    onWorkflowOperation(handleWorkflowOperation)
    onSubblockUpdate(handleSubblockUpdate)
    onVariableUpdate(handleVariableUpdate)
    onUserJoined(handleUserJoined)
    onUserLeft(handleUserLeft)
    onWorkflowDeleted(handleWorkflowDeleted)
    onWorkflowReverted(handleWorkflowReverted)
    onOperationConfirmed(handleOperationConfirmed)
    onOperationFailed(handleOperationFailed)

    return () => {
      // Cleanup handled by socket context
    }
  }, [
    onWorkflowOperation,
    onSubblockUpdate,
    onVariableUpdate,
    onUserJoined,
    onUserLeft,
    onWorkflowDeleted,
    onWorkflowReverted,
    onOperationConfirmed,
    onOperationFailed,
    workflowStore,
    subBlockStore,
    variablesStore,
    activeWorkflowId,
    confirmOperation,
    failOperation,
    emitWorkflowOperation,
    queue,
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

      if (!isInActiveRoom()) {
        logger.debug('Skipping operation - not in active workflow', {
          currentWorkflowId,
          activeWorkflowId,
          operation,
          target,
        })
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
        workflowId: activeWorkflowId || '',
        userId: session?.user?.id || 'unknown',
      })

      localAction()
    },
    [
      addToQueue,
      session?.user?.id,
      isBaselineDiffView,
      activeWorkflowId,
      isInActiveRoom,
      currentWorkflowId,
    ]
  )

  const collaborativeBatchUpdatePositions = useCallback(
    (updates: Array<{ id: string; position: Position }>) => {
      if (!isInActiveRoom()) {
        logger.debug('Skipping batch position update - not in active workflow')
        return
      }

      if (updates.length === 0) return

      const operationId = crypto.randomUUID()

      addToQueue({
        id: operationId,
        operation: {
          operation: 'batch-update-positions',
          target: 'blocks',
          payload: { updates },
        },
        workflowId: activeWorkflowId || '',
        userId: session?.user?.id || 'unknown',
      })

      updates.forEach(({ id, position }) => {
        workflowStore.updateBlockPosition(id, position)
      })
    },
    [addToQueue, activeWorkflowId, session?.user?.id, isInActiveRoom, workflowStore]
  )

  const collaborativeUpdateBlockName = useCallback(
    (id: string, name: string): { success: boolean; error?: string } => {
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

      const currentBlocks = workflowStore.blocks
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

      executeQueuedOperation('update-name', 'block', { id, name: trimmedName }, () => {
        const result = workflowStore.updateBlockName(id, trimmedName)

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
                  operation: 'subblock-update',
                  target: 'subblock',
                  payload: { blockId, subblockId: subBlockId, value: newValue },
                },
                workflowId: activeWorkflowId || '',
                userId: session?.user?.id || 'unknown',
              })
            }
          )
        }
      })

      return { success: true }
    },
    [executeQueuedOperation, workflowStore, addToQueue, activeWorkflowId, session?.user?.id]
  )

  const collaborativeToggleBlockEnabled = useCallback(
    (id: string) => {
      executeQueuedOperation('toggle-enabled', 'block', { id }, () =>
        workflowStore.toggleBlockEnabled(id)
      )
    },
    [executeQueuedOperation, workflowStore]
  )

  const collaborativeUpdateParentId = useCallback(
    (id: string, parentId: string, extent: 'parent') => {
      executeQueuedOperation('update-parent', 'block', { id, parentId, extent }, () =>
        workflowStore.updateParentId(id, parentId, extent)
      )
    },
    [executeQueuedOperation, workflowStore]
  )

  const collaborativeToggleBlockAdvancedMode = useCallback(
    (id: string) => {
      const currentBlock = workflowStore.blocks[id]
      if (!currentBlock) return

      const newAdvancedMode = !currentBlock.advancedMode

      executeQueuedOperation(
        'update-advanced-mode',
        'block',
        { id, advancedMode: newAdvancedMode },
        () => workflowStore.toggleBlockAdvancedMode(id)
      )
    },
    [executeQueuedOperation, workflowStore]
  )

  const collaborativeToggleBlockTriggerMode = useCallback(
    (id: string) => {
      const currentBlock = workflowStore.blocks[id]
      if (!currentBlock) return

      const newTriggerMode = !currentBlock.triggerMode

      // When enabling trigger mode, check if block is inside a subflow
      if (newTriggerMode && TriggerUtils.isBlockInSubflow(id, workflowStore.blocks)) {
        // Dispatch custom event to show warning modal
        window.dispatchEvent(
          new CustomEvent('show-trigger-warning', {
            detail: {
              type: 'trigger_in_subflow',
              triggerName: 'trigger',
            },
          })
        )
        return
      }

      executeQueuedOperation(
        'update-trigger-mode',
        'block',
        { id, triggerMode: newTriggerMode },
        () => workflowStore.toggleBlockTriggerMode(id)
      )
    },
    [executeQueuedOperation, workflowStore]
  )

  const collaborativeToggleBlockHandles = useCallback(
    (id: string) => {
      const currentBlock = workflowStore.blocks[id]
      if (!currentBlock) return

      const newHorizontalHandles = !currentBlock.horizontalHandles

      executeQueuedOperation(
        'toggle-handles',
        'block',
        { id, horizontalHandles: newHorizontalHandles },
        () => workflowStore.toggleBlockHandles(id)
      )
    },
    [executeQueuedOperation, workflowStore]
  )

  const collaborativeAddEdge = useCallback(
    (edge: Edge) => {
      executeQueuedOperation('add', 'edge', edge, () => workflowStore.addEdge(edge))
      // Only record edge addition if it's not part of a parent update operation
      if (!skipEdgeRecording.current) {
        undoRedo.recordAddEdge(edge.id)
      }
    },
    [executeQueuedOperation, workflowStore, undoRedo]
  )

  const collaborativeRemoveEdge = useCallback(
    (edgeId: string) => {
      const edge = workflowStore.edges.find((e) => e.id === edgeId)

      // Skip if edge doesn't exist (already removed during cascade deletion)
      if (!edge) {
        logger.debug('Edge already removed, skipping operation', { edgeId })
        return
      }

      // Check if the edge's source and target blocks still exist
      const sourceExists = workflowStore.blocks[edge.source]
      const targetExists = workflowStore.blocks[edge.target]

      if (!sourceExists || !targetExists) {
        logger.debug('Edge source or target block no longer exists, skipping operation', {
          edgeId,
          sourceExists: !!sourceExists,
          targetExists: !!targetExists,
        })
        return
      }

      // Only record edge removal if it's not part of a parent update operation
      if (!skipEdgeRecording.current) {
        undoRedo.recordRemoveEdge(edgeId, edge)
      }

      executeQueuedOperation('remove', 'edge', { id: edgeId }, () =>
        workflowStore.removeEdge(edgeId)
      )
    },
    [executeQueuedOperation, workflowStore, undoRedo]
  )

  const collaborativeSetSubblockValue = useCallback(
    (blockId: string, subblockId: string, value: any, options?: { _visited?: Set<string> }) => {
      if (isApplyingRemoteChange.current) return

      // Skip socket operations when viewing baseline diff
      if (isBaselineDiffView) {
        logger.debug('Skipping collaborative subblock update while viewing baseline diff')
        return
      }

      if (!isInActiveRoom()) {
        logger.debug('Skipping subblock update - not in active workflow', {
          currentWorkflowId,
          activeWorkflowId,
          blockId,
          subblockId,
        })
        return
      }

      // Generate operation ID for queue tracking
      const operationId = crypto.randomUUID()

      // Get fresh activeWorkflowId from store to avoid stale closure
      const currentActiveWorkflowId = useWorkflowRegistry.getState().activeWorkflowId

      // Add to queue for retry mechanism
      addToQueue({
        id: operationId,
        operation: {
          operation: 'subblock-update',
          target: 'subblock',
          payload: { blockId, subblockId, value },
        },
        workflowId: currentActiveWorkflowId || '',
        userId: session?.user?.id || 'unknown',
      })

      // Apply locally first (immediate UI feedback)
      subBlockStore.setValue(blockId, subblockId, value)

      // Declarative clearing: clear sub-blocks that depend on this subblockId
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
            // Skip clearing if the dependent is the same field
            if (!dep?.id || dep.id === subblockId) continue
            // Cascade using the same collaborative path so it emits and further cascades
            collaborativeSetSubblockValue(blockId, dep.id, '', { _visited: visited })
          }
        }
      } catch {
        // Best-effort; do not block on clearing
      }
    },
    [
      subBlockStore,
      currentWorkflowId,
      activeWorkflowId,
      addToQueue,
      session?.user?.id,
      isBaselineDiffView,
      isInActiveRoom,
    ]
  )

  // Immediate tag selection (uses queue but processes immediately, no debouncing)
  const collaborativeSetTagSelection = useCallback(
    (blockId: string, subblockId: string, value: any) => {
      if (isApplyingRemoteChange.current) return

      if (!isInActiveRoom()) {
        logger.debug('Skipping tag selection - not in active workflow', {
          currentWorkflowId,
          activeWorkflowId,
          blockId,
          subblockId,
        })
        return
      }

      // Apply locally first (immediate UI feedback)
      subBlockStore.setValue(blockId, subblockId, value)

      // Use the operation queue but with immediate processing (no debouncing)
      const operationId = crypto.randomUUID()

      addToQueue({
        id: operationId,
        operation: {
          operation: 'subblock-update',
          target: 'subblock',
          payload: { blockId, subblockId, value },
        },
        workflowId: activeWorkflowId || '',
        userId: session?.user?.id || 'unknown',
      })
    },
    [
      subBlockStore,
      addToQueue,
      currentWorkflowId,
      activeWorkflowId,
      session?.user?.id,
      isInActiveRoom,
    ]
  )

  const collaborativeUpdateLoopType = useCallback(
    (loopId: string, loopType: 'for' | 'forEach' | 'while' | 'doWhile') => {
      const currentBlock = workflowStore.blocks[loopId]
      if (!currentBlock || currentBlock.type !== 'loop') return

      const childNodes = Object.values(workflowStore.blocks)
        .filter((b) => b.data?.parentId === loopId)
        .map((b) => b.id)

      const currentIterations = currentBlock.data?.count || 5
      const currentCollection = currentBlock.data?.collection || ''

      const existingLoop = workflowStore.loops[loopId]
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

      executeQueuedOperation('update', 'subflow', { id: loopId, type: 'loop', config }, () => {
        workflowStore.updateLoopType(loopId, loopType)
        workflowStore.setLoopForEachItems(loopId, existingForEachItems ?? '')
        workflowStore.setLoopWhileCondition(loopId, existingWhileCondition ?? '')
        workflowStore.setLoopDoWhileCondition(loopId, existingDoWhileCondition ?? '')
      })
    },
    [executeQueuedOperation, workflowStore]
  )

  const collaborativeUpdateParallelType = useCallback(
    (parallelId: string, parallelType: 'count' | 'collection') => {
      const currentBlock = workflowStore.blocks[parallelId]
      if (!currentBlock || currentBlock.type !== 'parallel') return

      const childNodes = Object.values(workflowStore.blocks)
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
        'update',
        'subflow',
        { id: parallelId, type: 'parallel', config },
        () => {
          workflowStore.updateParallelType(parallelId, parallelType)
          workflowStore.updateParallelCount(parallelId, newCount)
          workflowStore.updateParallelCollection(parallelId, newDistribution)
        }
      )
    },
    [executeQueuedOperation, workflowStore]
  )

  // Unified iteration management functions - count and collection only
  const collaborativeUpdateIterationCount = useCallback(
    (nodeId: string, iterationType: 'loop' | 'parallel', count: number) => {
      const currentBlock = workflowStore.blocks[nodeId]
      if (!currentBlock || currentBlock.type !== iterationType) return

      const childNodes = Object.values(workflowStore.blocks)
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

        executeQueuedOperation('update', 'subflow', { id: nodeId, type: 'loop', config }, () =>
          workflowStore.updateLoopCount(nodeId, count)
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

        executeQueuedOperation('update', 'subflow', { id: nodeId, type: 'parallel', config }, () =>
          workflowStore.updateParallelCount(nodeId, count)
        )
      }
    },
    [executeQueuedOperation, workflowStore]
  )

  const collaborativeUpdateIterationCollection = useCallback(
    (nodeId: string, iterationType: 'loop' | 'parallel', collection: string) => {
      const currentBlock = workflowStore.blocks[nodeId]
      if (!currentBlock || currentBlock.type !== iterationType) return

      const childNodes = Object.values(workflowStore.blocks)
        .filter((b) => b.data?.parentId === nodeId)
        .map((b) => b.id)

      if (iterationType === 'loop') {
        const currentIterations = currentBlock.data?.count || 5
        const currentLoopType = currentBlock.data?.loopType || 'for'

        const existingLoop = workflowStore.loops[nodeId]
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

        executeQueuedOperation('update', 'subflow', { id: nodeId, type: 'loop', config }, () => {
          workflowStore.setLoopForEachItems(nodeId, nextForEachItems ?? '')
          workflowStore.setLoopWhileCondition(nodeId, nextWhileCondition ?? '')
          workflowStore.setLoopDoWhileCondition(nodeId, nextDoWhileCondition ?? '')
        })
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

        executeQueuedOperation('update', 'subflow', { id: nodeId, type: 'parallel', config }, () =>
          workflowStore.updateParallelCollection(nodeId, collection)
        )
      }
    },
    [executeQueuedOperation, workflowStore]
  )

  const collaborativeUpdateVariable = useCallback(
    (variableId: string, field: 'name' | 'value' | 'type', value: any) => {
      executeQueuedOperation('variable-update', 'variable', { variableId, field, value }, () => {
        if (field === 'name') {
          variablesStore.updateVariable(variableId, { name: value })
        } else if (field === 'value') {
          variablesStore.updateVariable(variableId, { value })
        } else if (field === 'type') {
          variablesStore.updateVariable(variableId, { type: value })
        }
      })
    },
    [executeQueuedOperation, variablesStore]
  )

  const collaborativeAddVariable = useCallback(
    (variableData: { name: string; type: any; value: any; workflowId: string }) => {
      const id = crypto.randomUUID()

      // Optimistically add to local store first
      variablesStore.addVariable(variableData, id)
      const processedVariable = useVariablesStore.getState().variables[id]

      if (processedVariable) {
        const payloadWithProcessedName = {
          ...variableData,
          id,
          name: processedVariable.name,
        }

        // Queue operation with processed name for server & other clients
        // Empty callback because local store is already updated above
        executeQueuedOperation('add', 'variable', payloadWithProcessedName, () => {})
      }

      return id
    },
    [executeQueuedOperation, variablesStore]
  )

  const collaborativeDeleteVariable = useCallback(
    (variableId: string) => {
      cancelOperationsForVariable(variableId)

      executeQueuedOperation('remove', 'variable', { variableId }, () => {
        variablesStore.deleteVariable(variableId)
      })
    },
    [executeQueuedOperation, variablesStore, cancelOperationsForVariable]
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
      if (!isInActiveRoom()) {
        logger.debug('Skipping batch add blocks - not in active workflow')
        return false
      }

      if (isBaselineDiffView) {
        logger.debug('Skipping batch add blocks while viewing baseline diff')
        return false
      }

      if (blocks.length === 0) return false

      logger.info('Batch adding blocks collaboratively', {
        blockCount: blocks.length,
        edgeCount: edges.length,
      })

      const operationId = crypto.randomUUID()

      addToQueue({
        id: operationId,
        operation: {
          operation: 'batch-add-blocks',
          target: 'blocks',
          payload: { blocks, edges, loops, parallels, subBlockValues },
        },
        workflowId: activeWorkflowId || '',
        userId: session?.user?.id || 'unknown',
      })

      blocks.forEach((block) => {
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
            triggerMode: block.triggerMode ?? false,
            height: block.height,
          }
        )
      })

      edges.forEach((edge) => {
        workflowStore.addEdge(edge)
      })

      if (Object.keys(loops).length > 0) {
        useWorkflowStore.setState((state) => ({
          loops: { ...state.loops, ...loops },
        }))
      }

      if (Object.keys(parallels).length > 0) {
        useWorkflowStore.setState((state) => ({
          parallels: { ...state.parallels, ...parallels },
        }))
      }

      if (activeWorkflowId) {
        Object.entries(subBlockValues).forEach(([blockId, subBlocks]) => {
          Object.entries(subBlocks).forEach(([subBlockId, value]) => {
            subBlockStore.setValue(blockId, subBlockId, value)
          })
        })
      }

      if (!options?.skipUndoRedo) {
        undoRedo.recordBatchAddBlocks(blocks, edges, subBlockValues)
      }

      return true
    },
    [
      addToQueue,
      activeWorkflowId,
      session?.user?.id,
      isBaselineDiffView,
      isInActiveRoom,
      workflowStore,
      subBlockStore,
      undoRedo,
    ]
  )

  const collaborativeBatchRemoveBlocks = useCallback(
    (blockIds: string[], options?: { skipUndoRedo?: boolean }) => {
      if (!isInActiveRoom()) {
        logger.debug('Skipping batch remove blocks - not in active workflow')
        return false
      }

      if (blockIds.length === 0) return false

      blockIds.forEach((id) => cancelOperationsForBlock(id))

      const allBlocksToRemove = new Set<string>(blockIds)
      const findAllDescendants = (parentId: string) => {
        Object.entries(workflowStore.blocks).forEach(([blockId, block]) => {
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

      const mergedBlocks = mergeSubblockState(workflowStore.blocks, activeWorkflowId || undefined)
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

      const edgeSnapshots = workflowStore.edges.filter(
        (e) => allBlocksToRemove.has(e.source) || allBlocksToRemove.has(e.target)
      )

      logger.info('Batch removing blocks collaboratively', {
        requestedCount: blockIds.length,
        totalCount: allBlocksToRemove.size,
      })

      const operationId = crypto.randomUUID()

      addToQueue({
        id: operationId,
        operation: {
          operation: 'batch-remove-blocks',
          target: 'blocks',
          payload: { ids: Array.from(allBlocksToRemove) },
        },
        workflowId: activeWorkflowId || '',
        userId: session?.user?.id || 'unknown',
      })

      blockIds.forEach((id) => {
        workflowStore.removeBlock(id)
      })

      if (!options?.skipUndoRedo && blockSnapshots.length > 0) {
        undoRedo.recordBatchRemoveBlocks(blockSnapshots, edgeSnapshots, subBlockValues)
      }

      return true
    },
    [
      addToQueue,
      activeWorkflowId,
      session?.user?.id,
      isInActiveRoom,
      workflowStore,
      cancelOperationsForBlock,
      undoRedo,
    ]
  )

  return {
    // Connection status
    isConnected,
    currentWorkflowId,
    presenceUsers,
    hasOperationError,

    // Workflow management
    joinWorkflow,
    leaveWorkflow,

    // Collaborative operations
    collaborativeBatchUpdatePositions,
    collaborativeUpdateBlockName,
    collaborativeToggleBlockEnabled,
    collaborativeUpdateParentId,
    collaborativeToggleBlockAdvancedMode,
    collaborativeToggleBlockTriggerMode,
    collaborativeToggleBlockHandles,
    collaborativeBatchAddBlocks,
    collaborativeBatchRemoveBlocks,
    collaborativeAddEdge,
    collaborativeRemoveEdge,
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

    // Direct access to stores for non-collaborative operations
    workflowStore,
    subBlockStore,

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
