import { useCallback, useEffect, useRef } from 'react'
import type { Edge } from 'reactflow'
import { useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { updateBlockReferences } from '@/lib/workflows/reference-utils'
import { getBlock } from '@/blocks'
import { resolveOutputType } from '@/blocks/utils'
import { useSocket } from '@/contexts/socket-context'
import { registerEmitFunctions, useOperationQueue } from '@/stores/operation-queue/store'
import { useVariablesStore } from '@/stores/panel/variables/store'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { Position } from '@/stores/workflows/workflow/types'

const logger = createLogger('CollaborativeWorkflow')

export function useCollaborativeWorkflow() {
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
  const { isShowingDiff } = useWorkflowDiffStore()

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
            case 'add':
              workflowStore.addBlock(
                payload.id,
                payload.type,
                payload.name,
                payload.position,
                payload.data,
                payload.parentId,
                payload.extent,
                {
                  enabled: payload.enabled,
                  horizontalHandles: payload.horizontalHandles,
                  isWide: payload.isWide,
                  advancedMode: payload.advancedMode,
                  triggerMode: payload.triggerMode ?? false,
                  height: payload.height,
                }
              )
              if (payload.autoConnectEdge) {
                workflowStore.addEdge(payload.autoConnectEdge)
              }
              break
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
            case 'remove':
              workflowStore.removeBlock(payload.id)
              // Clean up position timestamp tracking for removed blocks
              lastPositionTimestamps.current.delete(payload.id)
              break
            case 'toggle-enabled':
              workflowStore.toggleBlockEnabled(payload.id)
              break
            case 'update-parent':
              workflowStore.updateParentId(payload.id, payload.parentId, payload.extent)
              break
            case 'update-wide':
              workflowStore.setBlockWide(payload.id, payload.isWide)
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
            case 'duplicate':
              workflowStore.addBlock(
                payload.id,
                payload.type,
                payload.name,
                payload.position,
                payload.data,
                payload.parentId,
                payload.extent,
                {
                  enabled: payload.enabled,
                  horizontalHandles: payload.horizontalHandles,
                  isWide: payload.isWide,
                  advancedMode: payload.advancedMode,
                  triggerMode: payload.triggerMode ?? false,
                  height: payload.height,
                }
              )
              // Handle auto-connect edge if present
              if (payload.autoConnectEdge) {
                workflowStore.addEdge(payload.autoConnectEdge)
              }
              // Apply subblock values from duplicate payload so collaborators see content immediately
              if (payload.subBlocks && typeof payload.subBlocks === 'object') {
                Object.entries(payload.subBlocks).forEach(([subblockId, subblock]) => {
                  const value = (subblock as any)?.value
                  if (value !== undefined) {
                    subBlockStore.setValue(payload.id, subblockId, value)
                  }
                })
              }
              break
          }
        } else if (target === 'edge') {
          switch (operation) {
            case 'add':
              workflowStore.addEdge(payload as Edge)
              break
            case 'remove':
              workflowStore.removeEdge(payload.id)
              break
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
                  workflowStore.updateLoopCollection(payload.id, config.forEachItems)
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
            case 'duplicate-with-children': {
              // Apply a duplicated subflow subtree from a remote collaborator
              const parent = payload.parent
              const children = Array.isArray(payload.children) ? payload.children : []
              const edges = Array.isArray(payload.edges) ? payload.edges : []

              // Add parent block
              workflowStore.addBlock(
                parent.id,
                parent.type,
                parent.name,
                parent.position,
                parent.data,
                parent.parentId,
                parent.extent,
                {
                  enabled: parent.enabled,
                  horizontalHandles: parent.horizontalHandles,
                  isWide: parent.isWide,
                  advancedMode: parent.advancedMode,
                  triggerMode: parent.triggerMode ?? false,
                  height: parent.height,
                }
              )

              // Add children blocks
              children.forEach((child: any) => {
                workflowStore.addBlock(
                  child.id,
                  child.type,
                  child.name,
                  child.position,
                  child.data,
                  child.parentId,
                  child.extent,
                  {
                    enabled: child.enabled,
                    horizontalHandles: child.horizontalHandles,
                    isWide: child.isWide,
                    advancedMode: child.advancedMode,
                    triggerMode: child.triggerMode ?? false,
                    height: child.height,
                  }
                )

                // Apply subblock values for collaborators to see immediately
                if (child.subBlocks && typeof child.subBlocks === 'object') {
                  Object.entries(child.subBlocks).forEach(([subblockId, subblock]) => {
                    const value = (subblock as any)?.value
                    if (value !== undefined) {
                      subBlockStore.setValue(child.id, subblockId, value)
                    }
                  })
                }
              })

              // Add internal edges
              edges.forEach((edge: any) => {
                workflowStore.addEdge({
                  id: edge.id,
                  source: edge.source,
                  target: edge.target,
                  sourceHandle: edge.sourceHandle,
                  targetHandle: edge.targetHandle,
                })
              })

              break
            }
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
            case 'remove':
              variablesStore.deleteVariable(payload.variableId)
              break
            case 'duplicate':
              variablesStore.duplicateVariable(payload.sourceVariableId, payload.id)
              break
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

      // If the deleted workflow is the currently active one, we need to handle this gracefully
      if (activeWorkflowId === workflowId) {
        logger.info(
          `Currently active workflow ${workflowId} was deleted, stopping collaborative operations`
        )
        // The workflow registry should handle switching to another workflow
        // We just need to stop any pending collaborative operations
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
                  hasActiveWebhook: workflowData.state.hasActiveWebhook || false,
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

      // Skip socket operations when in diff mode
      if (isShowingDiff) {
        logger.debug('Skipping socket operation in diff mode:', operation)
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
      isShowingDiff,
      activeWorkflowId,
      isInActiveRoom,
      currentWorkflowId,
    ]
  )

  const executeQueuedDebouncedOperation = useCallback(
    (operation: string, target: string, payload: any, localAction: () => void) => {
      if (isApplyingRemoteChange.current) return

      if (isShowingDiff) {
        logger.debug('Skipping debounced socket operation in diff mode:', operation)
        return
      }

      if (!isInActiveRoom()) {
        logger.debug('Skipping debounced operation - not in active workflow', {
          currentWorkflowId,
          activeWorkflowId,
          operation,
          target,
        })
        return
      }

      localAction()

      emitWorkflowOperation(operation, target, payload)
    },
    [emitWorkflowOperation, isShowingDiff, isInActiveRoom, currentWorkflowId, activeWorkflowId]
  )

  const collaborativeAddBlock = useCallback(
    (
      id: string,
      type: string,
      name: string,
      position: Position,
      data?: Record<string, any>,
      parentId?: string,
      extent?: 'parent',
      autoConnectEdge?: Edge
    ) => {
      // Skip socket operations when in diff mode
      if (isShowingDiff) {
        logger.debug('Skipping collaborative add block in diff mode')
        return
      }

      if (!isInActiveRoom()) {
        logger.debug('Skipping collaborative add block - not in active workflow', {
          currentWorkflowId,
          activeWorkflowId,
        })
        return
      }

      const blockConfig = getBlock(type)

      // Handle loop/parallel blocks that don't use BlockConfig
      if (!blockConfig && (type === 'loop' || type === 'parallel')) {
        // For loop/parallel blocks, use empty subBlocks and outputs
        const completeBlockData = {
          id,
          type,
          name,
          position,
          data: data || {},
          subBlocks: {},
          outputs: {},
          enabled: true,
          horizontalHandles: true,
          isWide: false,
          advancedMode: false,
          height: 0,
          parentId,
          extent,
          autoConnectEdge, // Include edge data for atomic operation
        }

        // Skip if applying remote changes
        if (isApplyingRemoteChange.current) {
          workflowStore.addBlock(id, type, name, position, data, parentId, extent, {
            triggerMode: false,
          })
          if (autoConnectEdge) {
            workflowStore.addEdge(autoConnectEdge)
          }
          return
        }

        // Generate operation ID for queue tracking
        const operationId = crypto.randomUUID()

        // Add to queue for retry mechanism
        addToQueue({
          id: operationId,
          operation: {
            operation: 'add',
            target: 'block',
            payload: completeBlockData,
          },
          workflowId: activeWorkflowId || '',
          userId: session?.user?.id || 'unknown',
        })

        // Apply locally first (immediate UI feedback)
        workflowStore.addBlock(id, type, name, position, data, parentId, extent, {
          triggerMode: false,
        })
        if (autoConnectEdge) {
          workflowStore.addEdge(autoConnectEdge)
        }

        return
      }

      if (!blockConfig) {
        logger.error(`Block type ${type} not found`)
        return
      }

      // Generate subBlocks and outputs from the block configuration
      const subBlocks: Record<string, any> = {}

      // Create subBlocks from the block configuration
      if (blockConfig.subBlocks) {
        blockConfig.subBlocks.forEach((subBlock) => {
          subBlocks[subBlock.id] = {
            id: subBlock.id,
            type: subBlock.type,
            value: subBlock.defaultValue ?? null,
          }
        })
      }

      const outputs = resolveOutputType(blockConfig.outputs)

      const completeBlockData = {
        id,
        type,
        name,
        position,
        data: data || {},
        subBlocks,
        outputs,
        enabled: true,
        horizontalHandles: true,
        isWide: false,
        advancedMode: false,
        triggerMode: false,
        height: 0, // Default height, will be set by the UI
        parentId,
        extent,
        autoConnectEdge, // Include edge data for atomic operation
      }

      // Skip if applying remote changes
      if (isApplyingRemoteChange.current) return

      // Generate operation ID
      const operationId = crypto.randomUUID()

      // Add to queue
      addToQueue({
        id: operationId,
        operation: {
          operation: 'add',
          target: 'block',
          payload: completeBlockData,
        },
        workflowId: activeWorkflowId || '',
        userId: session?.user?.id || 'unknown',
      })

      // Apply locally
      workflowStore.addBlock(id, type, name, position, data, parentId, extent, {
        triggerMode: false,
      })
      if (autoConnectEdge) {
        workflowStore.addEdge(autoConnectEdge)
      }
    },
    [
      workflowStore,
      activeWorkflowId,
      addToQueue,
      session?.user?.id,
      isShowingDiff,
      isInActiveRoom,
      currentWorkflowId,
    ]
  )

  const collaborativeRemoveBlock = useCallback(
    (id: string) => {
      cancelOperationsForBlock(id)

      executeQueuedOperation('remove', 'block', { id }, () => workflowStore.removeBlock(id))
    },
    [executeQueuedOperation, workflowStore, cancelOperationsForBlock]
  )

  const collaborativeUpdateBlockPosition = useCallback(
    (id: string, position: Position) => {
      executeQueuedDebouncedOperation('update-position', 'block', { id, position }, () =>
        workflowStore.updateBlockPosition(id, position)
      )
    },
    [executeQueuedDebouncedOperation, workflowStore]
  )

  const collaborativeUpdateBlockName = useCallback(
    (id: string, name: string) => {
      executeQueuedOperation('update-name', 'block', { id, name }, () => {
        workflowStore.updateBlockName(id, name)
      })
    },
    [executeQueuedOperation, workflowStore]
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

  const collaborativeToggleBlockWide = useCallback(
    (id: string) => {
      // Get the current state before toggling
      const currentBlock = workflowStore.blocks[id]
      if (!currentBlock) return

      // Calculate the new isWide value
      const newIsWide = !currentBlock.isWide

      executeQueuedOperation('update-wide', 'block', { id, isWide: newIsWide }, () =>
        workflowStore.toggleBlockWide(id)
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
    },
    [executeQueuedOperation, workflowStore]
  )

  const collaborativeRemoveEdge = useCallback(
    (edgeId: string) => {
      executeQueuedOperation('remove', 'edge', { id: edgeId }, () =>
        workflowStore.removeEdge(edgeId)
      )
    },
    [executeQueuedOperation, workflowStore]
  )

  const collaborativeSetSubblockValue = useCallback(
    (blockId: string, subblockId: string, value: any, options?: { _visited?: Set<string> }) => {
      if (isApplyingRemoteChange.current) return

      // Skip socket operations when in diff mode
      if (isShowingDiff) {
        logger.debug('Skipping collaborative subblock update in diff mode')
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

      // Add to queue for retry mechanism
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
      isShowingDiff,
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
        immediate: true,
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

  const collaborativeDuplicateBlock = useCallback(
    (sourceId: string) => {
      if (!isInActiveRoom()) {
        logger.debug('Skipping duplicate block - not in active workflow', {
          currentWorkflowId,
          activeWorkflowId,
          sourceId,
        })
        return
      }

      const sourceBlock = workflowStore.blocks[sourceId]
      if (!sourceBlock) return

      // Generate new ID and calculate position
      const newId = crypto.randomUUID()
      const offsetPosition = {
        x: sourceBlock.position.x + 250,
        y: sourceBlock.position.y + 20,
      }

      const match = sourceBlock.name.match(/(.*?)(\d+)?$/)
      const newName = match?.[2]
        ? `${match[1]}${Number.parseInt(match[2]) + 1}`
        : `${sourceBlock.name} 1`

      // Get subblock values from the store
      const subBlockValues = subBlockStore.workflowValues[activeWorkflowId || '']?.[sourceId] || {}

      // Merge subblock structure with actual values
      const mergedSubBlocks = sourceBlock.subBlocks
        ? JSON.parse(JSON.stringify(sourceBlock.subBlocks))
        : {}
      Object.entries(subBlockValues).forEach(([subblockId, value]) => {
        if (mergedSubBlocks[subblockId]) {
          mergedSubBlocks[subblockId].value = value
        } else {
          // Create subblock if it doesn't exist in structure
          mergedSubBlocks[subblockId] = {
            id: subblockId,
            type: 'unknown',
            value: value,
          }
        }
      })

      // Create the complete block data for the socket operation
      const duplicatedBlockData = {
        sourceId,
        id: newId,
        type: sourceBlock.type,
        name: newName,
        position: offsetPosition,
        data: sourceBlock.data ? JSON.parse(JSON.stringify(sourceBlock.data)) : {},
        subBlocks: mergedSubBlocks,
        outputs: sourceBlock.outputs ? JSON.parse(JSON.stringify(sourceBlock.outputs)) : {},
        parentId: sourceBlock.data?.parentId || null,
        extent: sourceBlock.data?.extent || null,
        enabled: sourceBlock.enabled ?? true,
        horizontalHandles: sourceBlock.horizontalHandles ?? true,
        isWide: sourceBlock.isWide ?? false,
        advancedMode: sourceBlock.advancedMode ?? false,
        triggerMode: false, // Always duplicate as normal mode to avoid webhook conflicts
        height: sourceBlock.height || 0,
      }

      workflowStore.addBlock(
        newId,
        sourceBlock.type,
        newName,
        offsetPosition,
        sourceBlock.data ? JSON.parse(JSON.stringify(sourceBlock.data)) : {},
        sourceBlock.data?.parentId,
        sourceBlock.data?.extent,
        {
          enabled: sourceBlock.enabled,
          horizontalHandles: sourceBlock.horizontalHandles,
          isWide: sourceBlock.isWide,
          advancedMode: sourceBlock.advancedMode,
          triggerMode: false, // Always duplicate as normal mode
          height: sourceBlock.height,
        }
      )

      executeQueuedOperation('duplicate', 'block', duplicatedBlockData, () => {
        workflowStore.addBlock(
          newId,
          sourceBlock.type,
          newName,
          offsetPosition,
          sourceBlock.data ? JSON.parse(JSON.stringify(sourceBlock.data)) : {},
          sourceBlock.data?.parentId,
          sourceBlock.data?.extent,
          {
            enabled: sourceBlock.enabled,
            horizontalHandles: sourceBlock.horizontalHandles,
            isWide: sourceBlock.isWide,
            advancedMode: sourceBlock.advancedMode,
            triggerMode: false, // Always duplicate as normal mode
            height: sourceBlock.height,
          }
        )

        // Apply subblock values locally for immediate UI feedback
        // The server will persist these values as part of the block creation
        if (activeWorkflowId && Object.keys(subBlockValues).length > 0) {
          Object.entries(subBlockValues).forEach(([subblockId, value]) => {
            subBlockStore.setValue(newId, subblockId, value)
          })
        }
      })
    },
    [
      executeQueuedOperation,
      workflowStore,
      subBlockStore,
      activeWorkflowId,
      isInActiveRoom,
      currentWorkflowId,
    ]
  )

  const collaborativeDuplicateSubflow = useCallback(
    (subflowId: string) => {
      if (isShowingDiff) {
        logger.debug('Skipping subflow duplication in diff mode')
        return
      }
      if (!isInActiveRoom()) {
        logger.debug('Skipping subflow duplication - not in active workflow', {
          currentWorkflowId,
          activeWorkflowId,
          subflowId,
        })
        return
      }

      const parent = workflowStore.blocks[subflowId]
      if (!parent || (parent.type !== 'loop' && parent.type !== 'parallel')) return

      const newParentId = crypto.randomUUID()
      const parentOffsetPosition = {
        x: parent.position.x + 250,
        y: parent.position.y + 20,
      }

      // Name bump similar to duplicateBlock
      // Build a set of existing names to ensure uniqueness across the workflow
      const existingNames = new Set(Object.values(workflowStore.blocks).map((b) => b.name))

      const match = parent.name.match(/(.*?)(\d+)?$/)
      let newParentName = match?.[2]
        ? `${match[1]}${Number.parseInt(match[2]) + 1}`
        : `${parent.name} 1`
      if (existingNames.has(newParentName)) {
        const base = match ? match[1] : `${parent.name} `
        let idx = match?.[2] ? Number.parseInt(match[2]) + 1 : 1
        while (existingNames.has(`${base}${idx}`)) idx++
        newParentName = `${base}${idx}`
      }
      existingNames.add(newParentName)

      // Collect children and internal edges
      const allBlocks = workflowStore.blocks
      const children = Object.values(allBlocks).filter((b) => b.data?.parentId === subflowId)
      const childIdSet = new Set(children.map((c) => c.id))
      const allEdges = workflowStore.edges

      const startHandle = parent.type === 'loop' ? 'loop-start-source' : 'parallel-start-source'
      const internalEdges = allEdges.filter(
        (e) =>
          (e.source === subflowId && e.sourceHandle === startHandle && childIdSet.has(e.target)) ||
          (childIdSet.has(e.source) && childIdSet.has(e.target))
      )

      // Build ID map
      const idMap = new Map<string, string>()
      idMap.set(subflowId, newParentId)
      children.forEach((c) => idMap.set(c.id, crypto.randomUUID()))

      // Construct parent payload
      const parentPayload: any = {
        id: newParentId,
        sourceId: subflowId,
        type: parent.type,
        name: newParentName,
        position: parentOffsetPosition,
        data: parent.data ? JSON.parse(JSON.stringify(parent.data)) : {},
        subBlocks: {},
        outputs: parent.outputs ? JSON.parse(JSON.stringify(parent.outputs)) : {},
        parentId: parent.data?.parentId || null,
        extent: parent.data?.extent || null,
        enabled: parent.enabled ?? true,
        horizontalHandles: parent.horizontalHandles ?? true,
        isWide: parent.isWide ?? false,
        advancedMode: parent.advancedMode ?? false,
        triggerMode: false,
        height: parent.height || 0,
      }

      // Optimistic add of parent
      workflowStore.addBlock(
        newParentId,
        parent.type,
        newParentName,
        parentOffsetPosition,
        parentPayload.data,
        parentPayload.parentId,
        parentPayload.extent,
        {
          enabled: parentPayload.enabled,
          horizontalHandles: parentPayload.horizontalHandles,
          isWide: parentPayload.isWide,
          advancedMode: parentPayload.advancedMode,
          triggerMode: false,
          height: parentPayload.height,
        }
      )

      // Build children payloads, copy subblocks with values and update references
      const activeId = activeWorkflowId || ''
      const subblockValuesForWorkflow = subBlockStore.workflowValues[activeId] || {}

      const childPayloads = children.map((child) => {
        const newId = idMap.get(child.id) as string
        // Name bump logic identical to duplicateBlock
        const childNameMatch = child.name.match(/(.*?)(\d+)?$/)
        let newChildName = childNameMatch?.[2]
          ? `${childNameMatch[1]}${Number.parseInt(childNameMatch[2]) + 1}`
          : `${child.name} 1`
        if (existingNames.has(newChildName)) {
          const base = childNameMatch ? childNameMatch[1] : `${child.name} `
          let idx = childNameMatch?.[2] ? Number.parseInt(childNameMatch[2]) + 1 : 1
          while (existingNames.has(`${base}${idx}`)) idx++
          newChildName = `${base}${idx}`
        }
        existingNames.add(newChildName)
        const clonedSubBlocks = child.subBlocks ? JSON.parse(JSON.stringify(child.subBlocks)) : {}
        const values = subblockValuesForWorkflow[child.id] || {}
        Object.entries(values).forEach(([subblockId, value]) => {
          const processed = updateBlockReferences(value, idMap, 'duplicate-subflow')
          if (!clonedSubBlocks[subblockId]) {
            clonedSubBlocks[subblockId] = { id: subblockId, type: 'unknown', value: processed }
          } else {
            clonedSubBlocks[subblockId].value = processed
          }
        })

        // Optimistic add child
        workflowStore.addBlock(
          newId,
          child.type,
          newChildName,
          child.position,
          {
            ...(child.data ? JSON.parse(JSON.stringify(child.data)) : {}),
            parentId: newParentId,
            extent: 'parent',
          },
          newParentId,
          'parent',
          {
            enabled: child.enabled,
            horizontalHandles: child.horizontalHandles,
            isWide: child.isWide,
            advancedMode: child.advancedMode,
            triggerMode: child.triggerMode ?? false,
            height: child.height,
          }
        )

        // Apply subblock values locally for immediate feedback
        Object.entries(clonedSubBlocks).forEach(([subblockId, sub]) => {
          const v = (sub as any)?.value
          if (v !== undefined) {
            subBlockStore.setValue(newId, subblockId, v)
          }
        })

        return {
          id: newId,
          sourceId: child.id,
          type: child.type,
          name: newChildName,
          position: child.position,
          data: {
            ...(child.data ? JSON.parse(JSON.stringify(child.data)) : {}),
            parentId: newParentId,
            extent: 'parent',
          },
          subBlocks: clonedSubBlocks,
          outputs: child.outputs ? JSON.parse(JSON.stringify(child.outputs)) : {},
          parentId: newParentId,
          extent: 'parent',
          enabled: child.enabled ?? true,
          horizontalHandles: child.horizontalHandles ?? true,
          isWide: child.isWide ?? false,
          advancedMode: child.advancedMode ?? false,
          triggerMode: child.triggerMode ?? false,
          height: child.height || 0,
        }
      })

      // Duplicate internal edges with remapped IDs
      const edgePayloads = internalEdges.map((e) => ({
        id: crypto.randomUUID(),
        source: idMap.get(e.source) || e.source,
        target: idMap.get(e.target) || e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
      }))

      // Optimistic add edges
      edgePayloads.forEach((edge) => workflowStore.addEdge(edge))

      // Queue server op
      executeQueuedOperation(
        'duplicate-with-children',
        'subflow',
        {
          parent: parentPayload,
          children: childPayloads,
          edges: edgePayloads,
        },
        () => {}
      )
    },
    [
      isShowingDiff,
      isInActiveRoom,
      currentWorkflowId,
      activeWorkflowId,
      workflowStore,
      subBlockStore,
      executeQueuedOperation,
    ]
  )

  const collaborativeUpdateLoopType = useCallback(
    (loopId: string, loopType: 'for' | 'forEach') => {
      const currentBlock = workflowStore.blocks[loopId]
      if (!currentBlock || currentBlock.type !== 'loop') return

      const childNodes = Object.values(workflowStore.blocks)
        .filter((b) => b.data?.parentId === loopId)
        .map((b) => b.id)

      const currentIterations = currentBlock.data?.count || 5
      const currentCollection = currentBlock.data?.collection || ''

      const config = {
        id: loopId,
        nodes: childNodes,
        iterations: currentIterations,
        loopType,
        forEachItems: currentCollection,
      }

      executeQueuedOperation('update', 'subflow', { id: loopId, type: 'loop', config }, () =>
        workflowStore.updateLoopType(loopId, loopType)
      )
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
          iterations: Math.max(1, Math.min(100, count)), // Clamp between 1-100 for loops
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

        const config = {
          id: nodeId,
          nodes: childNodes,
          iterations: currentIterations,
          loopType: currentLoopType,
          forEachItems: collection,
        }

        executeQueuedOperation('update', 'subflow', { id: nodeId, type: 'loop', config }, () =>
          workflowStore.updateLoopCollection(nodeId, collection)
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
      variablesStore.addVariable(variableData, id)
      const processedVariable = useVariablesStore.getState().variables[id]

      if (processedVariable) {
        const payloadWithProcessedName = {
          ...variableData,
          id,
          name: processedVariable.name,
        }

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

  const collaborativeDuplicateVariable = useCallback(
    (variableId: string) => {
      const newId = crypto.randomUUID()
      const sourceVariable = useVariablesStore.getState().variables[variableId]
      if (!sourceVariable) return null

      executeQueuedOperation(
        'duplicate',
        'variable',
        { sourceVariableId: variableId, id: newId },
        () => {
          variablesStore.duplicateVariable(variableId, newId)
        }
      )
      return newId
    },
    [executeQueuedOperation, variablesStore]
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
    collaborativeAddBlock,
    collaborativeUpdateBlockPosition,
    collaborativeUpdateBlockName,
    collaborativeRemoveBlock,
    collaborativeToggleBlockEnabled,
    collaborativeUpdateParentId,
    collaborativeToggleBlockWide,
    collaborativeToggleBlockAdvancedMode,
    collaborativeToggleBlockTriggerMode,
    collaborativeToggleBlockHandles,
    collaborativeDuplicateBlock,
    collaborativeAddEdge,
    collaborativeRemoveEdge,
    collaborativeSetSubblockValue,
    collaborativeSetTagSelection,
    collaborativeDuplicateSubflow,

    // Collaborative variable operations
    collaborativeUpdateVariable,
    collaborativeAddVariable,
    collaborativeDeleteVariable,
    collaborativeDuplicateVariable,

    // Collaborative loop/parallel operations
    collaborativeUpdateLoopType,
    collaborativeUpdateParallelType,

    // Unified iteration operations
    collaborativeUpdateIterationCount,
    collaborativeUpdateIterationCollection,

    // Direct access to stores for non-collaborative operations
    workflowStore,
    subBlockStore,
  }
}
