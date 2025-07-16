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
    cancelOperationsForBlock,
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
                payload.extent
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
              workflowStore.toggleBlockAdvancedMode(payload.id)
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

      failOperation(operationId, retryable)
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

  const executeQueuedOperation = useCallback(
    (operation: string, target: string, payload: any, localAction: () => void) => {
      if (isApplyingRemoteChange.current) {
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
    [addToQueue, session?.user?.id]
  )

  const executeQueuedDebouncedOperation = useCallback(
    (operation: string, target: string, payload: any, localAction: () => void) => {
      if (isApplyingRemoteChange.current) return

      localAction()

      emitWorkflowOperation(operation, target, payload)
    },
    [emitWorkflowOperation]
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

        // Skip if applying remote changes
        if (isApplyingRemoteChange.current) {
          workflowStore.addBlock(id, type, name, position, data, parentId, extent)
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
        workflowStore.addBlock(id, type, name, position, data, parentId, extent)
        if (autoConnectEdge) {
          workflowStore.addEdge(autoConnectEdge)
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
    },
    [workflowStore, emitWorkflowOperation, addToQueue, session?.user?.id]
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

        // Handle pending subblock updates
        const globalWindow = window as any
        const pendingUpdates = globalWindow.__pendingSubblockUpdates
        if (pendingUpdates && Array.isArray(pendingUpdates)) {
          // Queue each subblock update individually
          for (const update of pendingUpdates) {
            const { blockId, subBlockId, newValue } = update
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

            subBlockStore.setValue(blockId, subBlockId, newValue)
          }
          // Clear the pending updates
          globalWindow.__pendingSubblockUpdates = undefined
        }
      })
    },
    [
      executeQueuedOperation,
      workflowStore,
      addToQueue,
      subBlockStore,
      activeWorkflowId,
      session?.user?.id,
    ]
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

      workflowStore.addBlock(
        newId,
        sourceBlock.type,
        newName,
        offsetPosition,
        sourceBlock.data ? JSON.parse(JSON.stringify(sourceBlock.data)) : {},
        sourceBlock.data?.parentId,
        sourceBlock.data?.extent
      )

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
        workflowStore.addBlock(
          newId,
          sourceBlock.type,
          newName,
          offsetPosition,
          sourceBlock.data ? JSON.parse(JSON.stringify(sourceBlock.data)) : {}
        )

        const subBlockValues = subBlockStore.workflowValues[activeWorkflowId || '']?.[sourceId]
        if (subBlockValues && activeWorkflowId) {
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
    [executeQueuedOperation, workflowStore]
  )

  const collaborativeSetSubblockValue = useCallback(
    (blockId: string, subblockId: string, value: any) => {
      if (isApplyingRemoteChange.current) return

      if (!currentWorkflowId || activeWorkflowId !== currentWorkflowId) {
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
    },
    [
      subBlockStore,
      emitSubblockUpdate,
      currentWorkflowId,
      activeWorkflowId,
      addToQueue,
      session?.user?.id,
    ]
  )

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

  const collaborativeUpdateLoopCollection = useCallback(
    (loopId: string, collection: string) => {
      const currentBlock = workflowStore.blocks[loopId]
      if (!currentBlock || currentBlock.type !== 'loop') return

      const childNodes = Object.values(workflowStore.blocks)
        .filter((b) => b.data?.parentId === loopId)
        .map((b) => b.id)

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
      const currentBlock = workflowStore.blocks[parallelId]
      if (!currentBlock || currentBlock.type !== 'parallel') return

      const childNodes = Object.values(workflowStore.blocks)
        .filter((b) => b.data?.parentId === parallelId)
        .map((b) => b.id)

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
      const currentBlock = workflowStore.blocks[parallelId]
      if (!currentBlock || currentBlock.type !== 'parallel') return

      const childNodes = Object.values(workflowStore.blocks)
        .filter((b) => b.data?.parentId === parallelId)
        .map((b) => b.id)

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
