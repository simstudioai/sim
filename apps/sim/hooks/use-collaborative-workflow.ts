import { useCallback, useEffect, useRef } from 'react'
import type { Edge } from 'reactflow'
import { useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console-logger'
import { getBlock } from '@/blocks'
import { resolveOutputType } from '@/blocks/utils'
import { useSocket } from '@/contexts/socket-context'
import { registerEmitFunctions, useOperationQueue } from '@/stores/operation-queue/store'
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
    onWorkflowOperation,
    onSubblockUpdate,
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
  const { data: session } = useSession()

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
    handleSocketReconnection,
  } = useOperationQueue()

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
    registerEmitFunctions(emitWorkflowOperation, emitSubblockUpdate, currentWorkflowId)
  }, [emitWorkflowOperation, emitSubblockUpdate, currentWorkflowId])

  // Log connection status changes and handle reconnection
  useEffect(() => {
    logger.info('Collaborative workflow connection status changed', {
      isConnected,
      currentWorkflowId,
      activeWorkflowId,
      presenceUsers: presenceUsers.length,
    })

    // Clear operation queue when socket reconnects AND has joined workflow
    // We need both isConnected=true AND currentWorkflowId to match activeWorkflowId
    // This ensures the socket has actually joined the workflow room before we allow retries
    if (isConnected && currentWorkflowId && currentWorkflowId === activeWorkflowId) {
      logger.info('Socket reconnected and joined workflow - clearing operation queue')
      handleSocketReconnection()
    }
  }, [
    isConnected,
    currentWorkflowId,
    activeWorkflowId,
    presenceUsers.length,
    handleSocketReconnection,
  ])

  // Handle incoming workflow operations from other users
  useEffect(() => {
    const handleWorkflowOperation = (data: any) => {
      const { operation, target, payload, userId } = data

      // Don't apply our own operations
      if (isApplyingRemoteChange.current) return

      logger.info(`Received ${operation} on ${target} from user ${userId}`)

      // Apply the operation to local state
      isApplyingRemoteChange.current = true

      try {
        if (target === 'block') {
          switch (operation) {
            case 'add':
              // Use normal addBlock - the collaborative system now sends complete data
              // and the validation schema preserves outputs and subBlocks
              workflowStore.addBlock(
                payload.id,
                payload.type,
                payload.name,
                payload.position,
                payload.data,
                payload.parentId,
                payload.extent
              )
              // Handle auto-connect edge if present
              if (payload.autoConnectEdge) {
                workflowStore.addEdge(payload.autoConnectEdge)
              }
              break
            case 'update-position': {
              // Apply position update only if it's newer than the last applied timestamp
              // This prevents jagged movement from out-of-order position updates
              const blockId = payload.id

              // Server should always provide timestamp - if missing, skip ordering check
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
              // Note: toggleBlockAdvancedMode doesn't take a parameter, it just toggles
              // For now, we'll use the existing toggle method
              workflowStore.toggleBlockAdvancedMode(payload.id)
              break
            case 'toggle-handles': {
              // Apply the handles toggle - we need to set the specific value to ensure consistency
              const currentBlock = workflowStore.blocks[payload.id]
              if (currentBlock && currentBlock.horizontalHandles !== payload.horizontalHandles) {
                workflowStore.toggleBlockHandles(payload.id)
              }
              break
            }
            case 'duplicate':
              // Apply the duplicate operation by adding the new block
              workflowStore.addBlock(
                payload.id,
                payload.type,
                payload.name,
                payload.position,
                payload.data,
                payload.parentId,
                payload.extent
              )
              // Handle auto-connect edge if present
              if (payload.autoConnectEdge) {
                workflowStore.addEdge(payload.autoConnectEdge)
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
                  hasActiveSchedule: workflowData.state.hasActiveSchedule || false,
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

      // Create a retry function that re-emits the operation using the correct channel
      const retryFunction = (operation: any) => {
        const { operation: op, target, payload } = operation.operation

        if (op === 'subblock-update' && target === 'subblock') {
          // Use subblock-update channel for subblock operations
          emitSubblockUpdate(payload.blockId, payload.subblockId, payload.value, operation.id)
        } else {
          // Use workflow-operation channel for block/edge/subflow operations
          emitWorkflowOperation(op, target, payload, operation.id)
        }
      }

      failOperation(operationId, retryFunction)
    }

    // Register event handlers
    onWorkflowOperation(handleWorkflowOperation)
    onSubblockUpdate(handleSubblockUpdate)
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
    onUserJoined,
    onUserLeft,
    onWorkflowDeleted,
    onWorkflowReverted,
    onOperationConfirmed,
    onOperationFailed,
    workflowStore,
    subBlockStore,
    activeWorkflowId,
    confirmOperation,
    failOperation,
    emitWorkflowOperation,
    queue,
  ])

  // Helper function to execute queued operations
  const executeQueuedOperation = useCallback(
    (operation: string, target: string, payload: any, localAction: () => void) => {
      console.log('🎯 executeQueuedOperation called', {
        operation,
        target,
        isApplyingRemoteChange: isApplyingRemoteChange.current,
      })

      // Skip if applying remote changes
      if (isApplyingRemoteChange.current) {
        console.log('❌ Skipping - applying remote change')
        return
      }

      // Generate operation ID
      const operationId = crypto.randomUUID()

      // Add to queue
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

      // Apply locally
      localAction()

      // Emit to server with operation ID
      emitWorkflowOperation(operation, target, payload, operationId)
    },
    [addToQueue, emitWorkflowOperation, session?.user?.id]
  )

  // Special helper for debounced operations (position updates)
  // These are high-frequency, low-importance operations that don't need queue tracking
  const executeQueuedDebouncedOperation = useCallback(
    (operation: string, target: string, payload: any, localAction: () => void) => {
      // Skip if applying remote changes
      if (isApplyingRemoteChange.current) return

      // Apply locally first (immediate UI feedback)
      localAction()

      // For debounced operations, don't use queue tracking
      // The debouncing in socket context handles reliability
      // No operation ID needed since we're not tracking these
      emitWorkflowOperation(operation, target, payload)
    },
    [emitWorkflowOperation]
  )

  // Collaborative workflow operations
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
      // Create complete block data upfront using the same logic as the store
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
          height: 0,
          parentId,
          extent,
          autoConnectEdge, // Include edge data for atomic operation
        }

        // Apply locally first
        workflowStore.addBlock(id, type, name, position, data, parentId, extent)
        if (autoConnectEdge) {
          workflowStore.addEdge(autoConnectEdge)
        }

        // Then broadcast to other clients with complete block data
        if (!isApplyingRemoteChange.current) {
          emitWorkflowOperation('add', 'block', completeBlockData)
        }
        return
      }

      if (!blockConfig) {
        console.error(`Block type ${type} not found`)
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
            value: null,
          }
        })
      }

      // Generate outputs using the same logic as the store
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
      workflowStore.addBlock(id, type, name, position, data, parentId, extent)
      if (autoConnectEdge) {
        workflowStore.addEdge(autoConnectEdge)
      }

      // Emit to server with operation ID
      emitWorkflowOperation('add', 'block', completeBlockData, operationId)
    },
    [workflowStore, emitWorkflowOperation, addToQueue, session?.user?.id]
  )

  const collaborativeRemoveBlock = useCallback(
    (id: string) => {
      executeQueuedOperation('remove', 'block', { id }, () => workflowStore.removeBlock(id))
    },
    [executeQueuedOperation, workflowStore]
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

        // Handle pending subblock updates
        const globalWindow = window as any
        const pendingUpdates = globalWindow.__pendingSubblockUpdates
        if (pendingUpdates && Array.isArray(pendingUpdates)) {
          // Emit collaborative subblock updates for each changed subblock
          for (const update of pendingUpdates) {
            const { blockId, subBlockId, newValue } = update
            emitSubblockUpdate(blockId, subBlockId, newValue)
          }
          // Clear the pending updates
          globalWindow.__pendingSubblockUpdates = undefined
        }
      })
    },
    [executeQueuedOperation, workflowStore, emitSubblockUpdate]
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
      // Get the current state before toggling
      const currentBlock = workflowStore.blocks[id]
      if (!currentBlock) return

      // Calculate the new advancedMode value
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

  const collaborativeToggleBlockHandles = useCallback(
    (id: string) => {
      // Get the current state before toggling
      const currentBlock = workflowStore.blocks[id]
      if (!currentBlock) return

      // Calculate the new horizontalHandles value
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

  const collaborativeDuplicateBlock = useCallback(
    (sourceId: string) => {
      const sourceBlock = workflowStore.blocks[sourceId]
      if (!sourceBlock) return

      // Generate new ID and calculate position
      const newId = crypto.randomUUID()
      const offsetPosition = {
        x: sourceBlock.position.x + 250,
        y: sourceBlock.position.y + 20,
      }

      // Generate new name with numbering
      const match = sourceBlock.name.match(/(.*?)(\d+)?$/)
      const newName = match?.[2]
        ? `${match[1]}${Number.parseInt(match[2]) + 1}`
        : `${sourceBlock.name} 1`

      // Create the complete block data for the socket operation
      const duplicatedBlockData = {
        sourceId,
        id: newId,
        type: sourceBlock.type,
        name: newName,
        position: offsetPosition,
        data: sourceBlock.data ? JSON.parse(JSON.stringify(sourceBlock.data)) : {},
        subBlocks: sourceBlock.subBlocks ? JSON.parse(JSON.stringify(sourceBlock.subBlocks)) : {},
        outputs: sourceBlock.outputs ? JSON.parse(JSON.stringify(sourceBlock.outputs)) : {},
        parentId: sourceBlock.data?.parentId || null,
        extent: sourceBlock.data?.extent || null,
        enabled: sourceBlock.enabled ?? true,
        horizontalHandles: sourceBlock.horizontalHandles ?? true,
        isWide: sourceBlock.isWide ?? false,
        height: sourceBlock.height || 0,
      }

      // Apply locally first using addBlock to ensure consistent IDs
      workflowStore.addBlock(
        newId,
        sourceBlock.type,
        newName,
        offsetPosition,
        sourceBlock.data ? JSON.parse(JSON.stringify(sourceBlock.data)) : {},
        sourceBlock.data?.parentId,
        sourceBlock.data?.extent
      )

      // Copy subblock values to the new block
      const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
      if (activeWorkflowId) {
        const subBlockValues =
          useSubBlockStore.getState().workflowValues[activeWorkflowId]?.[sourceId] || {}
        useSubBlockStore.setState((state) => ({
          workflowValues: {
            ...state.workflowValues,
            [activeWorkflowId]: {
              ...state.workflowValues[activeWorkflowId],
              [newId]: JSON.parse(JSON.stringify(subBlockValues)),
            },
          },
        }))
      }

      executeQueuedOperation('duplicate', 'block', duplicatedBlockData, () => {
        // Apply locally - add the duplicated block
        workflowStore.addBlock(
          newId,
          sourceBlock.type,
          newName,
          offsetPosition,
          sourceBlock.data ? JSON.parse(JSON.stringify(sourceBlock.data)) : {}
        )

        // Copy subblock values to the new block
        const subBlockValues = subBlockStore.workflowValues[activeWorkflowId || '']?.[sourceId]
        if (subBlockValues && activeWorkflowId) {
          // Copy each subblock value individually
          Object.entries(subBlockValues).forEach(([subblockId, value]) => {
            subBlockStore.setValue(newId, subblockId, value)
          })
        }
      })
    },
    [executeQueuedOperation, workflowStore, subBlockStore, activeWorkflowId]
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
    [workflowStore, emitWorkflowOperation]
  )

  const collaborativeSetSubblockValue = useCallback(
    (blockId: string, subblockId: string, value: any) => {
      // Skip if applying remote changes
      if (isApplyingRemoteChange.current) return

      // Check workflow state
      if (!currentWorkflowId || activeWorkflowId !== currentWorkflowId) {
        logger.debug('Skipping subblock update - not in active workflow', {
          currentWorkflowId,
          activeWorkflowId,
          blockId,
          subblockId,
        })
        return
      }

      // Apply locally first
      subBlockStore.setValue(blockId, subblockId, value)

      // Emit to server (subblock updates have their own handler with built-in retry)
      // No need for operation queue - the subblock handler already has confirmation/failure logic
      emitSubblockUpdate(blockId, subblockId, value)
    },
    [subBlockStore, emitSubblockUpdate, currentWorkflowId, activeWorkflowId]
  )

  // Collaborative loop/parallel configuration updates
  const collaborativeUpdateLoopCount = useCallback(
    (loopId: string, count: number) => {
      // Get current state BEFORE making changes
      const currentBlock = workflowStore.blocks[loopId]
      if (!currentBlock || currentBlock.type !== 'loop') return

      // Find child nodes before state changes
      const childNodes = Object.values(workflowStore.blocks)
        .filter((b) => b.data?.parentId === loopId)
        .map((b) => b.id)

      // Get current values to preserve them
      const currentLoopType = currentBlock.data?.loopType || 'for'
      const currentCollection = currentBlock.data?.collection || ''

      const config = {
        id: loopId,
        nodes: childNodes,
        iterations: count,
        loopType: currentLoopType,
        forEachItems: currentCollection,
      }

      executeQueuedOperation('update', 'subflow', { id: loopId, type: 'loop', config }, () =>
        workflowStore.updateLoopCount(loopId, count)
      )
    },
    [executeQueuedOperation, workflowStore]
  )

  const collaborativeUpdateLoopType = useCallback(
    (loopId: string, loopType: 'for' | 'forEach') => {
      // Get current state BEFORE making changes
      const currentBlock = workflowStore.blocks[loopId]
      if (!currentBlock || currentBlock.type !== 'loop') return

      // Find child nodes before state changes
      const childNodes = Object.values(workflowStore.blocks)
        .filter((b) => b.data?.parentId === loopId)
        .map((b) => b.id)

      // Get current values to preserve them
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

  const collaborativeUpdateLoopCollection = useCallback(
    (loopId: string, collection: string) => {
      // Get current state BEFORE making changes
      const currentBlock = workflowStore.blocks[loopId]
      if (!currentBlock || currentBlock.type !== 'loop') return

      // Find child nodes before state changes
      const childNodes = Object.values(workflowStore.blocks)
        .filter((b) => b.data?.parentId === loopId)
        .map((b) => b.id)

      // Get current values to preserve them
      const currentIterations = currentBlock.data?.count || 5
      const currentLoopType = currentBlock.data?.loopType || 'for'

      const config = {
        id: loopId,
        nodes: childNodes,
        iterations: currentIterations,
        loopType: currentLoopType,
        forEachItems: collection,
      }

      executeQueuedOperation('update', 'subflow', { id: loopId, type: 'loop', config }, () =>
        workflowStore.updateLoopCollection(loopId, collection)
      )
    },
    [executeQueuedOperation, workflowStore]
  )

  const collaborativeUpdateParallelCount = useCallback(
    (parallelId: string, count: number) => {
      // Get current state BEFORE making changes
      const currentBlock = workflowStore.blocks[parallelId]
      if (!currentBlock || currentBlock.type !== 'parallel') return

      // Find child nodes before state changes
      const childNodes = Object.values(workflowStore.blocks)
        .filter((b) => b.data?.parentId === parallelId)
        .map((b) => b.id)

      // Get current values to preserve them
      const currentDistribution = currentBlock.data?.collection || ''
      const currentParallelType = currentBlock.data?.parallelType || 'collection'

      const config = {
        id: parallelId,
        nodes: childNodes,
        count: Math.max(1, Math.min(20, count)), // Clamp between 1-20
        distribution: currentDistribution,
        parallelType: currentParallelType,
      }

      executeQueuedOperation(
        'update',
        'subflow',
        { id: parallelId, type: 'parallel', config },
        () => workflowStore.updateParallelCount(parallelId, count)
      )
    },
    [executeQueuedOperation, workflowStore]
  )

  const collaborativeUpdateParallelCollection = useCallback(
    (parallelId: string, collection: string) => {
      // Get current state BEFORE making changes
      const currentBlock = workflowStore.blocks[parallelId]
      if (!currentBlock || currentBlock.type !== 'parallel') return

      // Find child nodes before state changes
      const childNodes = Object.values(workflowStore.blocks)
        .filter((b) => b.data?.parentId === parallelId)
        .map((b) => b.id)

      // Get current values to preserve them
      const currentCount = currentBlock.data?.count || 5
      const currentParallelType = currentBlock.data?.parallelType || 'collection'

      const config = {
        id: parallelId,
        nodes: childNodes,
        count: currentCount,
        distribution: collection,
        parallelType: currentParallelType,
      }

      executeQueuedOperation(
        'update',
        'subflow',
        { id: parallelId, type: 'parallel', config },
        () => workflowStore.updateParallelCollection(parallelId, collection)
      )
    },
    [executeQueuedOperation, workflowStore]
  )

  const collaborativeUpdateParallelType = useCallback(
    (parallelId: string, parallelType: 'count' | 'collection') => {
      // Get current state BEFORE making changes
      const currentBlock = workflowStore.blocks[parallelId]
      if (!currentBlock || currentBlock.type !== 'parallel') return

      // Find child nodes before state changes
      const childNodes = Object.values(workflowStore.blocks)
        .filter((b) => b.data?.parentId === parallelId)
        .map((b) => b.id)

      // Calculate new values based on type change
      let newCount = currentBlock.data?.count || 5
      let newDistribution = currentBlock.data?.collection || ''

      // Reset values based on type (same logic as the UI)
      if (parallelType === 'count') {
        newDistribution = ''
        // Keep existing count
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
          // Apply all changes locally
          workflowStore.updateParallelType(parallelId, parallelType)
          workflowStore.updateParallelCount(parallelId, newCount)
          workflowStore.updateParallelCollection(parallelId, newDistribution)
        }
      )
    },
    [executeQueuedOperation, workflowStore]
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
    collaborativeToggleBlockHandles,
    collaborativeDuplicateBlock,
    collaborativeAddEdge,
    collaborativeRemoveEdge,
    collaborativeSetSubblockValue,

    // Collaborative loop/parallel operations
    collaborativeUpdateLoopCount,
    collaborativeUpdateLoopType,
    collaborativeUpdateLoopCollection,
    collaborativeUpdateParallelCount,
    collaborativeUpdateParallelCollection,
    collaborativeUpdateParallelType,

    // Direct access to stores for non-collaborative operations
    workflowStore,
    subBlockStore,
  }
}
