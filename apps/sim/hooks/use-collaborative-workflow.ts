import { useCallback, useEffect, useRef } from 'react'
import type { Edge } from 'reactflow'
import { createLogger } from '@/lib/logs/console-logger'
import { useSocket } from '@/contexts/socket-context'
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
  } = useSocket()

  const { activeWorkflowId } = useWorkflowRegistry()
  const workflowStore = useWorkflowStore()
  const subBlockStore = useSubBlockStore()

  // Track if we're applying remote changes to avoid infinite loops
  const isApplyingRemoteChange = useRef(false)

  // Join workflow room when active workflow changes
  useEffect(() => {
    if (activeWorkflowId && isConnected && currentWorkflowId !== activeWorkflowId) {
      logger.info(`Joining workflow room: ${activeWorkflowId}`, {
        isConnected,
        currentWorkflowId,
        activeWorkflowId,
        presenceUsers: presenceUsers.length,
      })
      joinWorkflow(activeWorkflowId)
    }
  }, [activeWorkflowId, isConnected, currentWorkflowId, joinWorkflow])

  // Log connection status changes
  useEffect(() => {
    logger.info('Collaborative workflow connection status changed', {
      isConnected,
      currentWorkflowId,
      activeWorkflowId,
      presenceUsers: presenceUsers.length,
    })
  }, [isConnected, currentWorkflowId, activeWorkflowId, presenceUsers.length])

  // Handle incoming workflow operations from other users
  useEffect(() => {
    const handleWorkflowOperation = (data: any) => {
      const { operation, target, payload, senderId, userId } = data

      // Don't apply our own operations
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
              break
            case 'update-position':
              // Apply immediate position update with smooth interpolation for other users
              workflowStore.updateBlockPosition(payload.id, payload.position)
              break
            case 'update-name':
              workflowStore.updateBlockName(payload.id, payload.name)
              break
            case 'remove':
              workflowStore.removeBlock(payload.id)
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
        }
      } catch (error) {
        logger.error('Error applying remote operation:', error)
      } finally {
        isApplyingRemoteChange.current = false
      }
    }

    const handleSubblockUpdate = (data: any) => {
      const { blockId, subblockId, value, senderId, userId } = data

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

    // Register event handlers
    onWorkflowOperation(handleWorkflowOperation)
    onSubblockUpdate(handleSubblockUpdate)
    onUserJoined(handleUserJoined)
    onUserLeft(handleUserLeft)
    onWorkflowDeleted(handleWorkflowDeleted)

    return () => {
      // Cleanup handled by socket context
    }
  }, [
    onWorkflowOperation,
    onSubblockUpdate,
    onUserJoined,
    onUserLeft,
    onWorkflowDeleted,
    workflowStore,
    subBlockStore,
    activeWorkflowId,
  ])

  // Collaborative workflow operations
  const collaborativeAddBlock = useCallback(
    (
      id: string,
      type: string,
      name: string,
      position: Position,
      data?: Record<string, any>,
      parentId?: string,
      extent?: 'parent'
    ) => {
      // Apply locally first
      workflowStore.addBlock(id, type, name, position, data, parentId, extent)

      // Then broadcast to other clients
      if (!isApplyingRemoteChange.current) {
        emitWorkflowOperation('add', 'block', {
          id,
          type,
          name,
          position,
          data,
          parentId,
          extent,
        })
      }
    },
    [workflowStore, emitWorkflowOperation]
  )

  const collaborativeRemoveBlock = useCallback(
    (id: string) => {
      // Apply locally first
      workflowStore.removeBlock(id)

      // Then broadcast to other clients
      if (!isApplyingRemoteChange.current) {
        emitWorkflowOperation('remove', 'block', { id })
      }
    },
    [workflowStore, emitWorkflowOperation]
  )

  const collaborativeUpdateBlockPosition = useCallback(
    (id: string, position: Position) => {
      // Apply locally first
      workflowStore.updateBlockPosition(id, position)

      // Then broadcast to other clients
      if (!isApplyingRemoteChange.current) {
        emitWorkflowOperation('update-position', 'block', { id, position })
      }
    },
    [workflowStore, emitWorkflowOperation]
  )

  const collaborativeUpdateBlockName = useCallback(
    (id: string, name: string) => {
      // Apply locally first
      workflowStore.updateBlockName(id, name)

      // Then broadcast to other clients
      if (!isApplyingRemoteChange.current) {
        emitWorkflowOperation('update-name', 'block', { id, name })
      }
    },
    [workflowStore, emitWorkflowOperation]
  )

  const collaborativeToggleBlockEnabled = useCallback(
    (id: string) => {
      // Apply locally first
      workflowStore.toggleBlockEnabled(id)

      // Then broadcast to other clients
      if (!isApplyingRemoteChange.current) {
        emitWorkflowOperation('toggle-enabled', 'block', { id })
      }
    },
    [workflowStore, emitWorkflowOperation]
  )

  const collaborativeUpdateParentId = useCallback(
    (id: string, parentId: string, extent: 'parent') => {
      // Apply locally first
      workflowStore.updateParentId(id, parentId, extent)

      // Then broadcast to other clients
      if (!isApplyingRemoteChange.current) {
        emitWorkflowOperation('update-parent', 'block', { id, parentId, extent })
      }
    },
    [workflowStore, emitWorkflowOperation]
  )

  const collaborativeToggleBlockWide = useCallback(
    (id: string) => {
      // Get the current state before toggling
      const currentBlock = workflowStore.blocks[id]
      if (!currentBlock) return

      // Calculate the new isWide value
      const newIsWide = !currentBlock.isWide

      // Apply locally first
      workflowStore.toggleBlockWide(id)

      // Emit with the calculated new value (don't rely on async state update)
      if (!isApplyingRemoteChange.current) {
        emitWorkflowOperation('update-wide', 'block', { id, isWide: newIsWide })
      }
    },
    [workflowStore, emitWorkflowOperation]
  )

  const collaborativeToggleBlockAdvancedMode = useCallback(
    (id: string) => {
      // Get the current state before toggling
      const currentBlock = workflowStore.blocks[id]
      if (!currentBlock) return

      // Calculate the new advancedMode value
      const newAdvancedMode = !currentBlock.advancedMode

      // Apply locally first
      workflowStore.toggleBlockAdvancedMode(id)

      // Emit with the calculated new value (don't rely on async state update)
      if (!isApplyingRemoteChange.current) {
        emitWorkflowOperation('update-advanced-mode', 'block', {
          id,
          advancedMode: newAdvancedMode,
        })
      }
    },
    [workflowStore, emitWorkflowOperation]
  )

  const collaborativeAddEdge = useCallback(
    (edge: Edge) => {
      // Apply locally first
      workflowStore.addEdge(edge)

      // Then broadcast to other clients
      if (!isApplyingRemoteChange.current) {
        emitWorkflowOperation('add', 'edge', edge)
      }
    },
    [workflowStore, emitWorkflowOperation]
  )

  const collaborativeRemoveEdge = useCallback(
    (edgeId: string) => {
      // Apply locally first
      workflowStore.removeEdge(edgeId)

      // Then broadcast to other clients
      if (!isApplyingRemoteChange.current) {
        emitWorkflowOperation('remove', 'edge', { id: edgeId })
      }
    },
    [workflowStore, emitWorkflowOperation]
  )

  const collaborativeSetSubblockValue = useCallback(
    (blockId: string, subblockId: string, value: any) => {
      // Apply locally first - the store automatically uses the active workflow ID
      subBlockStore.setValue(blockId, subblockId, value)

      // Then broadcast to other clients, but only if we have a valid workflow connection
      if (
        !isApplyingRemoteChange.current &&
        isConnected &&
        currentWorkflowId &&
        activeWorkflowId === currentWorkflowId
      ) {
        emitSubblockUpdate(blockId, subblockId, value)
      } else if (!isConnected || !currentWorkflowId || activeWorkflowId !== currentWorkflowId) {
        logger.debug('Skipping subblock update broadcast', {
          isConnected,
          currentWorkflowId,
          activeWorkflowId,
          blockId,
          subblockId,
        })
      }
    },
    [subBlockStore, emitSubblockUpdate, isConnected, currentWorkflowId, activeWorkflowId]
  )

  // Collaborative loop/parallel configuration updates
  const collaborativeUpdateLoopCount = useCallback(
    (loopId: string, count: number) => {
      // Apply locally first
      workflowStore.updateLoopCount(loopId, count)

      // Emit subflow update operation to persist configuration changes
      if (!isApplyingRemoteChange.current) {
        // Build the configuration manually to ensure it matches the database structure
        const block = workflowStore.blocks[loopId]
        if (block && block.type === 'loop') {
          // Find child nodes
          const childNodes = Object.values(workflowStore.blocks)
            .filter((b) => b.data?.parentId === loopId)
            .map((b) => b.id)

          const config = {
            id: loopId,
            nodes: childNodes,
            iterations: count,
            loopType: block.data?.loopType || 'for',
            forEachItems: block.data?.collection || '',
          }

          emitWorkflowOperation('update', 'subflow', {
            id: loopId,
            type: 'loop',
            config,
          })
        }
      }
    },
    [workflowStore, emitWorkflowOperation]
  )

  const collaborativeUpdateLoopType = useCallback(
    (loopId: string, loopType: 'for' | 'forEach') => {
      // Apply locally first
      workflowStore.updateLoopType(loopId, loopType)

      // Emit subflow update operation to persist configuration changes
      if (!isApplyingRemoteChange.current) {
        const block = workflowStore.blocks[loopId]
        if (block && block.type === 'loop') {
          // Find child nodes
          const childNodes = Object.values(workflowStore.blocks)
            .filter((b) => b.data?.parentId === loopId)
            .map((b) => b.id)

          const config = {
            id: loopId,
            nodes: childNodes,
            iterations: block.data?.count || 5,
            loopType,
            forEachItems: block.data?.collection || '',
          }

          emitWorkflowOperation('update', 'subflow', {
            id: loopId,
            type: 'loop',
            config,
          })
        }
      }
    },
    [workflowStore, emitWorkflowOperation]
  )

  const collaborativeUpdateLoopCollection = useCallback(
    (loopId: string, collection: string) => {
      // Apply locally first
      workflowStore.updateLoopCollection(loopId, collection)

      // Emit subflow update operation to persist configuration changes
      if (!isApplyingRemoteChange.current) {
        const block = workflowStore.blocks[loopId]
        if (block && block.type === 'loop') {
          // Find child nodes
          const childNodes = Object.values(workflowStore.blocks)
            .filter((b) => b.data?.parentId === loopId)
            .map((b) => b.id)

          const config = {
            id: loopId,
            nodes: childNodes,
            iterations: block.data?.count || 5,
            loopType: block.data?.loopType || 'for',
            forEachItems: collection,
          }

          emitWorkflowOperation('update', 'subflow', {
            id: loopId,
            type: 'loop',
            config,
          })
        }
      }
    },
    [workflowStore, emitWorkflowOperation]
  )

  const collaborativeUpdateParallelCount = useCallback(
    (parallelId: string, count: number) => {
      // Apply locally first
      workflowStore.updateParallelCount(parallelId, count)

      // Emit subflow update operation to persist configuration changes
      if (!isApplyingRemoteChange.current) {
        const block = workflowStore.blocks[parallelId]
        if (block && block.type === 'parallel') {
          // Find child nodes
          const childNodes = Object.values(workflowStore.blocks)
            .filter((b) => b.data?.parentId === parallelId)
            .map((b) => b.id)

          const config = {
            id: parallelId,
            nodes: childNodes,
            count: Math.max(1, Math.min(20, count)), // Clamp between 1-20
            distribution: block.data?.collection || '',
            parallelType: block.data?.parallelType || 'collection',
          }

          emitWorkflowOperation('update', 'subflow', {
            id: parallelId,
            type: 'parallel',
            config,
          })
        }
      }
    },
    [workflowStore, emitWorkflowOperation]
  )

  const collaborativeUpdateParallelCollection = useCallback(
    (parallelId: string, collection: string) => {
      // Apply locally first
      workflowStore.updateParallelCollection(parallelId, collection)

      // Emit subflow update operation to persist configuration changes
      if (!isApplyingRemoteChange.current) {
        const parallels = workflowStore.parallels
        const config = parallels[parallelId]

        if (config) {
          const block = workflowStore.blocks[parallelId]
          emitWorkflowOperation('update', 'subflow', {
            id: parallelId,
            type: 'parallel',
            config: {
              ...config,
              distribution: collection, // Ensure the new collection is included
              parallelType: block?.data?.parallelType || 'collection', // Include parallelType
            },
          })
        }
      }
    },
    [workflowStore, emitWorkflowOperation]
  )

  const collaborativeUpdateParallelType = useCallback(
    (parallelId: string, parallelType: 'count' | 'collection') => {
      // Apply locally first
      workflowStore.updateParallelType(parallelId, parallelType)

      // Emit subflow update operation to persist configuration changes
      if (!isApplyingRemoteChange.current) {
        const block = workflowStore.blocks[parallelId]
        if (block && block.type === 'parallel') {
          // Find child nodes
          const childNodes = Object.values(workflowStore.blocks)
            .filter((b) => b.data?.parentId === parallelId)
            .map((b) => b.id)

          const config = {
            id: parallelId,
            nodes: childNodes,
            count: block.data?.count || 5,
            distribution: block.data?.collection || '',
            parallelType,
          }

          emitWorkflowOperation('update', 'subflow', {
            id: parallelId,
            type: 'parallel',
            config,
          })
        }
      }
    },
    [workflowStore, emitWorkflowOperation]
  )

  return {
    // Connection status
    isConnected,
    currentWorkflowId,
    presenceUsers,

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
