import type { Edge } from 'reactflow'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console-logger'
import { getBlock } from '@/blocks'
import { resolveOutputType } from '@/blocks/utils'
import { pushHistory, type WorkflowStoreWithHistory, withHistory } from '../middleware'
import { useWorkflowRegistry } from '../registry/store'
import { useSubBlockStore } from '../subblock/store'
// import { markWorkflowsDirty, workflowSync } from '../sync' // Disabled for socket-based sync
import { mergeSubblockState } from '../utils'
import type { Position, SubBlockState, SyncControl, WorkflowState } from './types'
import { generateLoopBlocks, generateParallelBlocks } from './utils'

const logger = createLogger('WorkflowStore')

const initialState = {
  blocks: {},
  edges: [],
  loops: {},
  parallels: {},
  lastSaved: undefined,
  // Legacy deployment fields (keeping for compatibility but they will be deprecated)
  isDeployed: false,
  deployedAt: undefined,
  // New field for per-workflow deployment tracking
  deploymentStatuses: {},
  needsRedeployment: false,
  hasActiveWebhook: false,
  history: {
    past: [],
    present: {
      state: {
        blocks: {},
        edges: [],
        loops: {},
        parallels: {},
        isDeployed: false,
        isPublished: false,
      },
      timestamp: Date.now(),
      action: 'Initial state',
      subblockValues: {},
    },
    future: [],
  },
}

// Create a consolidated sync control implementation
/**
 * Socket-based SyncControl implementation (replaces HTTP sync)
 */
const createSyncControl = (): SyncControl => ({
  markDirty: () => {
    // No-op: Socket-based sync handles this automatically
  },
  isDirty: () => {
    // Always return false since socket sync is real-time
    return false
  },
  forceSync: () => {
    // No-op: Socket-based sync is always in sync
  },
})

export const useWorkflowStore = create<WorkflowStoreWithHistory>()(
  devtools(
    withHistory((set, get) => ({
      ...initialState,
      undo: () => {},
      redo: () => {},
      canUndo: () => false,
      canRedo: () => false,
      revertToHistoryState: () => {},

      // Implement sync control interface
      sync: createSyncControl(),

      setNeedsRedeploymentFlag: (needsRedeployment: boolean) => {
        set({ needsRedeployment })
      },

      addBlock: (
        id: string,
        type: string,
        name: string,
        position: Position,
        data?: Record<string, any>,
        parentId?: string,
        extent?: 'parent'
      ) => {
        const blockConfig = getBlock(type)
        // For custom nodes like loop and parallel that don't use BlockConfig
        if (!blockConfig && (type === 'loop' || type === 'parallel')) {
          // Merge parentId and extent into data if provided
          const nodeData = {
            ...data,
            ...(parentId && { parentId, extent: extent || 'parent' }),
          }

          const newState = {
            blocks: {
              ...get().blocks,
              [id]: {
                id,
                type,
                name,
                position,
                subBlocks: {},
                outputs: {},
                enabled: true,
                horizontalHandles: true,
                isWide: false,
                height: 0,
                data: nodeData,
              },
            },
            edges: [...get().edges],
            loops: get().generateLoopBlocks(),
            parallels: get().generateParallelBlocks(),
          }

          set(newState)
          pushHistory(set, get, newState, `Add ${type} node`)
          get().updateLastSaved()
          // get().sync.markDirty() // Disabled: Using socket-based sync
          return
        }

        if (!blockConfig) return

        // Merge parentId and extent into data for regular blocks
        const nodeData = {
          ...data,
          ...(parentId && { parentId, extent: extent || 'parent' }),
        }

        const subBlocks: Record<string, SubBlockState> = {}
        blockConfig.subBlocks.forEach((subBlock) => {
          const subBlockId = subBlock.id
          subBlocks[subBlockId] = {
            id: subBlockId,
            type: subBlock.type,
            value: null,
          }
        })

        const outputs = resolveOutputType(blockConfig.outputs)

        const newState = {
          blocks: {
            ...get().blocks,
            [id]: {
              id,
              type,
              name,
              position,
              subBlocks,
              outputs,
              enabled: true,
              horizontalHandles: true,
              isWide: false,
              height: 0,
              data: nodeData,
            },
          },
          edges: [...get().edges],
          loops: get().generateLoopBlocks(),
          parallels: get().generateParallelBlocks(),
        }

        set(newState)
        pushHistory(set, get, newState, `Add ${type} block`)
        get().updateLastSaved()
        // get().sync.markDirty() // Disabled: Using socket-based sync
      },

      updateBlockPosition: (id: string, position: Position) => {
        set((state) => ({
          blocks: {
            ...state.blocks,
            [id]: {
              ...state.blocks[id],
              position,
            },
          },
          edges: [...state.edges],
        }))
        get().updateLastSaved()
        // No sync for position updates to avoid excessive syncing during drag
      },

      updateNodeDimensions: (id: string, dimensions: { width: number; height: number }) => {
        set((state) => ({
          blocks: {
            ...state.blocks,
            [id]: {
              ...state.blocks[id],
              data: {
                ...state.blocks[id].data,
                width: dimensions.width,
                height: dimensions.height,
              },
            },
          },
          edges: [...state.edges],
        }))
        get().updateLastSaved()
        // Note: Socket.IO handles real-time sync automatically
      },

      updateParentId: (id: string, parentId: string, extent: 'parent') => {
        const block = get().blocks[id]
        if (!block) {
          logger.warn(`Cannot set parent: Block ${id} not found`)
          return
        }

        logger.info('UpdateParentId called:', {
          blockId: id,
          blockName: block.name,
          blockType: block.type,
          newParentId: parentId,
          extent,
          currentParentId: block.data?.parentId,
        })

        // Skip if the parent ID hasn't changed
        if (block.data?.parentId === parentId) {
          logger.info('Parent ID unchanged, skipping update')
          return
        }

        // Store current absolute position
        const absolutePosition = { ...block.position }

        // Handle empty or null parentId (removing from parent)
        const newData = !parentId
          ? { ...block.data } // Remove parentId and extent if empty
          : {
              ...block.data,
              parentId,
              extent,
            }

        // Remove parentId and extent properties for empty parent ID
        if (!parentId && newData.parentId) {
          newData.parentId = undefined
          newData.extent = undefined
        }

        const newState = {
          blocks: {
            ...get().blocks,
            [id]: {
              ...block,
              position: absolutePosition,
              data: newData,
            },
          },
          edges: [...get().edges],
          loops: { ...get().loops },
          parallels: { ...get().parallels },
        }

        logger.info('[WorkflowStore/updateParentId] Updated parentId relationship:', {
          blockId: id,
          newParentId: parentId || 'None (removed parent)',
          keepingPosition: absolutePosition,
        })

        set(newState)
        pushHistory(
          set,
          get,
          newState,
          parentId ? `Set parent for ${block.name}` : `Remove parent for ${block.name}`
        )
        get().updateLastSaved()
        // Note: Socket.IO handles real-time sync automatically
      },

      removeBlock: (id: string) => {
        // First, clean up any subblock values for this block
        const subBlockStore = useSubBlockStore.getState()
        const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId

        const newState = {
          blocks: { ...get().blocks },
          edges: [...get().edges].filter((edge) => edge.source !== id && edge.target !== id),
          loops: { ...get().loops },
          parallels: { ...get().parallels },
        }

        // Find and remove all child blocks if this is a parent node
        const blocksToRemove = new Set([id])

        // Recursively find all descendant blocks (children, grandchildren, etc.)
        const findAllDescendants = (parentId: string) => {
          Object.entries(newState.blocks).forEach(([blockId, block]) => {
            if (block.data?.parentId === parentId) {
              blocksToRemove.add(blockId)
              // Recursively find this block's children
              findAllDescendants(blockId)
            }
          })
        }

        // Start recursive search from the target block
        findAllDescendants(id)

        logger.info('Found blocks to remove:', {
          targetId: id,
          totalBlocksToRemove: Array.from(blocksToRemove),
          includesHierarchy: blocksToRemove.size > 1,
        })

        // Clean up subblock values before removing the block
        if (activeWorkflowId && subBlockStore.workflowValues) {
          const updatedWorkflowValues = {
            ...(subBlockStore.workflowValues[activeWorkflowId] || {}),
          }

          // Remove values for all blocks being deleted
          blocksToRemove.forEach((blockId) => {
            delete updatedWorkflowValues[blockId]
          })

          // Update subblock store
          useSubBlockStore.setState((state) => ({
            workflowValues: {
              ...state.workflowValues,
              [activeWorkflowId]: updatedWorkflowValues,
            },
          }))
        }

        // Remove all edges connected to any of the blocks being removed
        newState.edges = newState.edges.filter(
          (edge) => !blocksToRemove.has(edge.source) && !blocksToRemove.has(edge.target)
        )

        // Delete all blocks marked for removal
        blocksToRemove.forEach((blockId) => {
          delete newState.blocks[blockId]
        })

        set(newState)
        pushHistory(set, get, newState, 'Remove block and children')
        get().updateLastSaved()
        // Note: Socket.IO handles real-time sync automatically
      },

      addEdge: (edge: Edge) => {
        // Check for duplicate connections
        const isDuplicate = get().edges.some(
          (existingEdge) =>
            existingEdge.source === edge.source &&
            existingEdge.target === edge.target &&
            existingEdge.sourceHandle === edge.sourceHandle &&
            existingEdge.targetHandle === edge.targetHandle
        )

        // If it's a duplicate connection, return early without adding the edge
        if (isDuplicate) {
          return
        }

        const newEdge = {
          id: edge.id || crypto.randomUUID(),
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
        }

        const newEdges = [...get().edges, newEdge]

        const newState = {
          blocks: { ...get().blocks },
          edges: newEdges,
          loops: generateLoopBlocks(get().blocks),
          parallels: get().generateParallelBlocks(),
        }

        set(newState)
        pushHistory(set, get, newState, 'Add connection')
        get().updateLastSaved()
        // get().sync.markDirty() // Disabled: Using socket-based sync
      },

      removeEdge: (edgeId: string) => {
        // Validate the edge exists
        const edgeToRemove = get().edges.find((edge) => edge.id === edgeId)
        if (!edgeToRemove) {
          logger.warn(`Attempted to remove non-existent edge: ${edgeId}`)
          return
        }

        const newEdges = get().edges.filter((edge) => edge.id !== edgeId)

        const newState = {
          blocks: { ...get().blocks },
          edges: newEdges,
          loops: generateLoopBlocks(get().blocks),
          parallels: get().generateParallelBlocks(),
        }

        set(newState)
        pushHistory(set, get, newState, 'Remove connection')
        get().updateLastSaved()
        // get().sync.markDirty() // Disabled: Using socket-based sync
      },

      clear: () => {
        const newState = {
          blocks: {},
          edges: [],
          loops: {},
          parallels: {},
          history: {
            past: [],
            present: {
              state: {
                blocks: {},
                edges: [],
                loops: {},
                parallels: {},
                isDeployed: false,
                isPublished: false,
              },
              timestamp: Date.now(),
              action: 'Initial state',
              subblockValues: {},
            },
            future: [],
          },
          lastSaved: Date.now(),
          isDeployed: false,
          isPublished: false,
          hasActiveWebhook: false,
        }
        set(newState)
        // Note: Socket.IO handles real-time sync automatically
        return newState
      },

      updateLastSaved: () => {
        set({ lastSaved: Date.now() })
        // Note: Socket.IO handles real-time sync automatically
      },

      toggleBlockEnabled: (id: string) => {
        const newState = {
          blocks: {
            ...get().blocks,
            [id]: {
              ...get().blocks[id],
              enabled: !get().blocks[id].enabled,
            },
          },
          edges: [...get().edges],
          loops: { ...get().loops },
          parallels: { ...get().parallels },
        }

        set(newState)
        get().updateLastSaved()
        // Note: Socket.IO handles real-time sync automatically
      },

      duplicateBlock: (id: string) => {
        const block = get().blocks[id]
        if (!block) return

        const newId = crypto.randomUUID()
        const offsetPosition = {
          x: block.position.x + 250,
          y: block.position.y + 20,
        }

        // More efficient name handling
        const match = block.name.match(/(.*?)(\d+)?$/)
        const newName = match?.[2]
          ? `${match[1]}${Number.parseInt(match[2]) + 1}`
          : `${block.name} 1`

        // Get merged state to capture current subblock values
        const mergedBlock = mergeSubblockState(get().blocks, id)[id]

        // Create new subblocks with merged values
        const newSubBlocks = Object.entries(mergedBlock.subBlocks).reduce(
          (acc, [subId, subBlock]) => ({
            ...acc,
            [subId]: {
              ...subBlock,
              value: JSON.parse(JSON.stringify(subBlock.value)),
            },
          }),
          {}
        )

        const newState = {
          blocks: {
            ...get().blocks,
            [newId]: {
              ...block,
              id: newId,
              name: newName,
              position: offsetPosition,
              subBlocks: newSubBlocks,
            },
          },
          edges: [...get().edges],
          loops: get().generateLoopBlocks(),
          parallels: get().generateParallelBlocks(),
        }

        // Update the subblock store with the duplicated values
        const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
        if (activeWorkflowId) {
          const subBlockValues =
            useSubBlockStore.getState().workflowValues[activeWorkflowId]?.[id] || {}
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

        set(newState)
        pushHistory(set, get, newState, `Duplicate ${block.type} block`)
        get().updateLastSaved()
        // Note: Socket.IO handles real-time sync automatically
      },

      toggleBlockHandles: (id: string) => {
        const newState = {
          blocks: {
            ...get().blocks,
            [id]: {
              ...get().blocks[id],
              horizontalHandles: !get().blocks[id].horizontalHandles,
            },
          },
          edges: [...get().edges],
          loops: { ...get().loops },
        }

        set(newState)
        get().updateLastSaved()
        // Note: Socket.IO handles real-time sync automatically
      },

      updateBlockName: (id: string, name: string) => {
        const oldBlock = get().blocks[id]
        if (!oldBlock) return

        // Create a new state with the updated block name
        const newState = {
          blocks: {
            ...get().blocks,
            [id]: {
              ...oldBlock,
              name,
            },
          },
          edges: [...get().edges],
          loops: { ...get().loops },
          parallels: { ...get().parallels },
        }

        // Update references in subblock store
        const subBlockStore = useSubBlockStore.getState()
        const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
        if (activeWorkflowId) {
          // Get the workflow values for the active workflow
          // workflowValues: {[block_id]:{[subblock_id]:[subblock_value]}}
          const workflowValues = subBlockStore.workflowValues[activeWorkflowId] || {}
          const updatedWorkflowValues = { ...workflowValues }
          const changedSubblocks: Array<{ blockId: string; subBlockId: string; newValue: any }> = []

          // Loop through blocks
          Object.entries(workflowValues).forEach(([blockId, blockValues]) => {
            if (blockId === id) return // Skip the block being renamed

            // Loop through subblocks and update references
            Object.entries(blockValues).forEach(([subBlockId, value]) => {
              const oldBlockName = oldBlock.name.replace(/\s+/g, '').toLowerCase()
              const newBlockName = name.replace(/\s+/g, '').toLowerCase()
              const regex = new RegExp(`<${oldBlockName}\\.`, 'g')

              // Use a recursive function to handle all object types
              const updatedValue = updateReferences(value, regex, `<${newBlockName}.`)

              // Check if the value actually changed
              if (JSON.stringify(updatedValue) !== JSON.stringify(value)) {
                updatedWorkflowValues[blockId][subBlockId] = updatedValue
                changedSubblocks.push({
                  blockId,
                  subBlockId,
                  newValue: updatedValue,
                })
              }

              // Helper function to recursively update references in any data structure
              function updateReferences(value: any, regex: RegExp, replacement: string): any {
                // Handle string values
                if (typeof value === 'string') {
                  return regex.test(value) ? value.replace(regex, replacement) : value
                }

                // Handle arrays
                if (Array.isArray(value)) {
                  return value.map((item) => updateReferences(item, regex, replacement))
                }

                // Handle objects
                if (value !== null && typeof value === 'object') {
                  const result = { ...value }
                  for (const key in result) {
                    result[key] = updateReferences(result[key], regex, replacement)
                  }
                  return result
                }

                // Return unchanged for other types
                return value
              }
            })
          })

          // Update the subblock store with the new values
          useSubBlockStore.setState({
            workflowValues: {
              ...subBlockStore.workflowValues,
              [activeWorkflowId]: updatedWorkflowValues,
            },
          })

          // Store changed subblocks for collaborative sync
          if (changedSubblocks.length > 0) {
            // Store the changed subblocks for the collaborative function to pick up
            ;(window as any).__pendingSubblockUpdates = changedSubblocks
          }
        }

        set(newState)
        pushHistory(set, get, newState, `${name} block name updated`)
        get().updateLastSaved()
        // Note: Socket.IO handles real-time sync automatically
      },

      toggleBlockWide: (id: string) => {
        set((state) => ({
          blocks: {
            ...state.blocks,
            [id]: {
              ...state.blocks[id],
              isWide: !state.blocks[id].isWide,
            },
          },
          edges: [...state.edges],
          loops: { ...state.loops },
        }))
        get().updateLastSaved()
        // Note: Socket.IO handles real-time sync automatically
      },

      setBlockWide: (id: string, isWide: boolean) => {
        set((state) => ({
          blocks: {
            ...state.blocks,
            [id]: {
              ...state.blocks[id],
              isWide,
            },
          },
          edges: [...state.edges],
          loops: { ...state.loops },
        }))
        get().updateLastSaved()
        // Note: Socket.IO handles real-time sync automatically
      },

      setBlockAdvancedMode: (id: string, advancedMode: boolean) => {
        set((state) => ({
          blocks: {
            ...state.blocks,
            [id]: {
              ...state.blocks[id],
              advancedMode,
            },
          },
          edges: [...state.edges],
          loops: { ...state.loops },
        }))
        get().updateLastSaved()
        // Note: Socket.IO handles real-time sync automatically
      },

      updateBlockHeight: (id: string, height: number) => {
        set((state) => ({
          blocks: {
            ...state.blocks,
            [id]: {
              ...state.blocks[id],
              height,
            },
          },
          edges: [...state.edges],
          loops: { ...state.loops },
        }))
        get().updateLastSaved()
        // No sync needed for height changes, just visual
      },

      updateLoopCount: (loopId: string, count: number) =>
        set((state) => {
          const block = state.blocks[loopId]
          if (!block || block.type !== 'loop') return state

          const newBlocks = {
            ...state.blocks,
            [loopId]: {
              ...block,
              data: {
                ...block.data,
                count: Math.max(1, Math.min(50, count)), // Clamp between 1-50
              },
            },
          }

          return {
            blocks: newBlocks,
            edges: [...state.edges],
            loops: generateLoopBlocks(newBlocks), // Regenerate loops
          }
        }),

      updateLoopType: (loopId: string, loopType: 'for' | 'forEach') =>
        set((state) => {
          const block = state.blocks[loopId]
          if (!block || block.type !== 'loop') return state

          const newBlocks = {
            ...state.blocks,
            [loopId]: {
              ...block,
              data: {
                ...block.data,
                loopType,
              },
            },
          }

          return {
            blocks: newBlocks,
            edges: [...state.edges],
            loops: generateLoopBlocks(newBlocks), // Regenerate loops
          }
        }),

      updateLoopCollection: (loopId: string, collection: string) =>
        set((state) => {
          const block = state.blocks[loopId]
          if (!block || block.type !== 'loop') return state

          const newBlocks = {
            ...state.blocks,
            [loopId]: {
              ...block,
              data: {
                ...block.data,
                collection,
              },
            },
          }

          return {
            blocks: newBlocks,
            edges: [...state.edges],
            loops: generateLoopBlocks(newBlocks), // Regenerate loops
          }
        }),

      // Function to convert UI loop blocks to execution format
      generateLoopBlocks: () => {
        return generateLoopBlocks(get().blocks)
      },

      triggerUpdate: () => {
        set((state) => ({
          ...state,
          lastUpdate: Date.now(),
        }))
      },

      setWebhookStatus: (hasActiveWebhook: boolean) => {
        // Only update if the status has changed to avoid unnecessary rerenders
        if (get().hasActiveWebhook !== hasActiveWebhook) {
          set({ hasActiveWebhook })
          get().updateLastSaved()
          // Note: Socket.IO handles real-time sync automatically
        }
      },

      revertToDeployedState: async (deployedState: WorkflowState) => {
        const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId

        if (!activeWorkflowId) {
          logger.error('Cannot revert: no active workflow ID')
          return
        }

        // Preserving the workflow-specific deployment status if it exists
        const deploymentStatus = useWorkflowRegistry
          .getState()
          .getWorkflowDeploymentStatus(activeWorkflowId)

        const newState = {
          blocks: deployedState.blocks,
          edges: deployedState.edges,
          loops: deployedState.loops || {},
          parallels: deployedState.parallels || {},
          isDeployed: true,
          needsRedeployment: false,
          hasActiveWebhook: false, // Reset webhook status
          // Keep existing deployment statuses and update for the active workflow if needed
          deploymentStatuses: {
            ...get().deploymentStatuses,
            ...(deploymentStatus
              ? {
                  [activeWorkflowId]: deploymentStatus,
                }
              : {}),
          },
        }

        // Update the main workflow state
        set(newState)

        // Initialize subblock store with values from deployed state
        const subBlockStore = useSubBlockStore.getState()
        const values: Record<string, Record<string, any>> = {}

        // Extract subblock values from deployed blocks
        Object.entries(deployedState.blocks).forEach(([blockId, block]) => {
          values[blockId] = {}
          Object.entries(block.subBlocks || {}).forEach(([subBlockId, subBlock]) => {
            values[blockId][subBlockId] = subBlock.value
          })
        })

        // Update subblock store with deployed values
        useSubBlockStore.setState({
          workflowValues: {
            ...subBlockStore.workflowValues,
            [activeWorkflowId]: values,
          },
        })

        // Check if there's an active webhook in the deployed state
        const starterBlock = Object.values(deployedState.blocks).find(
          (block) => block.type === 'starter'
        )
        if (starterBlock && starterBlock.subBlocks?.startWorkflow?.value === 'webhook') {
          set({ hasActiveWebhook: true })
        }

        pushHistory(set, get, newState, 'Reverted to deployed state')
        get().updateLastSaved()

        // Call API to persist the revert to normalized tables
        try {
          const response = await fetch(`/api/workflows/${activeWorkflowId}/revert-to-deployed`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
          })

          if (!response.ok) {
            const errorData = await response.json()
            logger.error('Failed to persist revert to deployed state:', errorData.error)
            // Don't throw error to avoid breaking the UI, but log it
          } else {
            logger.info('Successfully persisted revert to deployed state')
          }
        } catch (error) {
          logger.error('Error calling revert to deployed API:', error)
          // Don't throw error to avoid breaking the UI
        }
      },

      toggleBlockAdvancedMode: (id: string) => {
        const block = get().blocks[id]
        if (!block) return

        const newState = {
          blocks: {
            ...get().blocks,
            [id]: {
              ...block,
              advancedMode: !block.advancedMode,
            },
          },
          edges: [...get().edges],
          loops: { ...get().loops },
        }

        set(newState)

        // Clear the appropriate subblock values based on the new mode
        const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
        if (activeWorkflowId) {
          const subBlockStore = useSubBlockStore.getState()
          const blockValues = subBlockStore.workflowValues[activeWorkflowId]?.[id] || {}
          const updatedValues = { ...blockValues }

          if (!block.advancedMode) {
            // Switching TO advanced mode
            // Preserve systemPrompt and userPrompt, memories starts empty
            // No need to clear anything since advanced mode has all fields
          } else {
            // Switching TO basic mode
            // Preserve systemPrompt and userPrompt, but clear memories
            updatedValues.memories = null
          }

          // Update subblock store with the cleared values
          useSubBlockStore.setState({
            workflowValues: {
              ...subBlockStore.workflowValues,
              [activeWorkflowId]: {
                ...subBlockStore.workflowValues[activeWorkflowId],
                [id]: updatedValues,
              },
            },
          })
        }

        get().triggerUpdate()
        // Note: Socket.IO handles real-time sync automatically
      },

      // Parallel block methods implementation
      updateParallelCount: (parallelId: string, count: number) => {
        const block = get().blocks[parallelId]
        if (!block || block.type !== 'parallel') return

        const newBlocks = {
          ...get().blocks,
          [parallelId]: {
            ...block,
            data: {
              ...block.data,
              count: Math.max(1, Math.min(50, count)), // Clamp between 1-50
            },
          },
        }

        const newState = {
          blocks: newBlocks,
          edges: [...get().edges],
          loops: { ...get().loops },
          parallels: generateParallelBlocks(newBlocks), // Regenerate parallels
        }

        set(newState)
        pushHistory(set, get, newState, `Update parallel count`)
        get().updateLastSaved()
        // Note: Socket.IO handles real-time sync automatically
      },

      updateParallelCollection: (parallelId: string, collection: string) => {
        const block = get().blocks[parallelId]
        if (!block || block.type !== 'parallel') return

        const newBlocks = {
          ...get().blocks,
          [parallelId]: {
            ...block,
            data: {
              ...block.data,
              collection,
            },
          },
        }

        const newState = {
          blocks: newBlocks,
          edges: [...get().edges],
          loops: { ...get().loops },
          parallels: generateParallelBlocks(newBlocks), // Regenerate parallels
        }

        set(newState)
        pushHistory(set, get, newState, `Update parallel collection`)
        get().updateLastSaved()
        // Note: Socket.IO handles real-time sync automatically
      },

      updateParallelType: (parallelId: string, parallelType: 'count' | 'collection') => {
        const block = get().blocks[parallelId]
        if (!block || block.type !== 'parallel') return

        const newBlocks = {
          ...get().blocks,
          [parallelId]: {
            ...block,
            data: {
              ...block.data,
              parallelType,
            },
          },
        }

        const newState = {
          blocks: newBlocks,
          edges: [...get().edges],
          loops: { ...get().loops },
          parallels: generateParallelBlocks(newBlocks), // Regenerate parallels
        }

        set(newState)
        pushHistory(set, get, newState, `Update parallel type`)
        get().updateLastSaved()
        // Note: Socket.IO handles real-time sync automatically
      },

      // Function to convert UI parallel blocks to execution format
      generateParallelBlocks: () => {
        return generateParallelBlocks(get().blocks)
      },
    })),
    { name: 'workflow-store' }
  )
)
