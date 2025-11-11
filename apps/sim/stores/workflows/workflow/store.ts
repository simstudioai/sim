import type { Edge } from 'reactflow'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console/logger'
import { getBlockOutputs } from '@/lib/workflows/block-outputs'
import { TriggerUtils } from '@/lib/workflows/triggers'
import { getBlock } from '@/blocks'
import type { SubBlockConfig } from '@/blocks/types'
import { isAnnotationOnlyBlock } from '@/executor/consts'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import {
  getUniqueBlockName,
  mergeSubblockState,
  normalizeBlockName,
} from '@/stores/workflows/utils'
import type {
  Position,
  SubBlockState,
  WorkflowState,
  WorkflowStore,
} from '@/stores/workflows/workflow/types'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'

const logger = createLogger('WorkflowStore')

/**
 * Creates a deep clone of an initial sub-block value to avoid shared references.
 *
 * @param value - The value to clone.
 * @returns A cloned value suitable for initializing sub-block state.
 */
function cloneInitialSubblockValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => cloneInitialSubblockValue(item))
  }

  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>(
      (acc, [key, entry]) => {
        acc[key] = cloneInitialSubblockValue(entry)
        return acc
      },
      {}
    )
  }

  return value ?? null
}

/**
 * Resolves the initial value for a sub-block based on its configuration.
 *
 * @param config - The sub-block configuration.
 * @returns The resolved initial value or null when no defaults are defined.
 */
function resolveInitialSubblockValue(config: SubBlockConfig): unknown {
  if (typeof config.value === 'function') {
    try {
      const resolved = config.value({})
      return cloneInitialSubblockValue(resolved)
    } catch (error) {
      logger.warn('Failed to resolve dynamic sub-block default value', {
        subBlockId: config.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (config.defaultValue !== undefined) {
    return cloneInitialSubblockValue(config.defaultValue)
  }

  if (config.type === 'input-format') {
    return [
      {
        id: crypto.randomUUID(),
        name: '',
        type: 'string',
        value: '',
        collapsed: false,
      },
    ]
  }

  if (config.type === 'table') {
    return []
  }

  return null
}

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
}

export const useWorkflowStore = create<WorkflowStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

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
        extent?: 'parent',
        blockProperties?: {
          enabled?: boolean
          horizontalHandles?: boolean
          advancedMode?: boolean
          triggerMode?: boolean
          height?: number
        }
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
                enabled: blockProperties?.enabled ?? true,
                horizontalHandles: blockProperties?.horizontalHandles ?? true,
                advancedMode: blockProperties?.advancedMode ?? false,
                triggerMode: blockProperties?.triggerMode ?? false,
                height: blockProperties?.height ?? 0,
                data: nodeData,
              },
            },
            edges: [...get().edges],
            loops: get().generateLoopBlocks(),
            parallels: get().generateParallelBlocks(),
          }

          set(newState)
          get().updateLastSaved()
          return
        }

        if (!blockConfig) return

        // Merge parentId and extent into data for regular blocks
        const nodeData = {
          ...data,
          ...(parentId && { parentId, extent: extent || 'parent' }),
        }

        const subBlocks: Record<string, SubBlockState> = {}
        const subBlockStore = useSubBlockStore.getState()
        const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId

        blockConfig.subBlocks.forEach((subBlock) => {
          const subBlockId = subBlock.id
          const initialValue = resolveInitialSubblockValue(subBlock)
          const normalizedValue =
            initialValue !== undefined && initialValue !== null ? initialValue : null

          subBlocks[subBlockId] = {
            id: subBlockId,
            type: subBlock.type,
            value: normalizedValue as SubBlockState['value'],
          }

          if (activeWorkflowId) {
            try {
              const valueToStore =
                initialValue !== undefined ? cloneInitialSubblockValue(initialValue) : null
              subBlockStore.setValue(id, subBlockId, valueToStore)
            } catch (error) {
              logger.warn('Failed to seed sub-block store value during block creation', {
                blockId: id,
                subBlockId,
                error: error instanceof Error ? error.message : String(error),
              })
            }
          } else {
            logger.warn('Cannot seed sub-block store value: activeWorkflowId not available', {
              blockId: id,
              subBlockId,
            })
          }
        })

        // Get outputs based on trigger mode
        const triggerMode = blockProperties?.triggerMode ?? false
        const outputs = getBlockOutputs(type, subBlocks, triggerMode)

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
              enabled: blockProperties?.enabled ?? true,
              horizontalHandles: blockProperties?.horizontalHandles ?? true,
              advancedMode: blockProperties?.advancedMode ?? false,
              triggerMode: triggerMode,
              height: blockProperties?.height ?? 0,
              layout: {},
              data: nodeData,
            },
          },
          edges: [...get().edges],
          loops: get().generateLoopBlocks(),
          parallels: get().generateParallelBlocks(),
        }

        set(newState)
        get().updateLastSaved()
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
        set((state) => {
          // Check if the block exists before trying to update it
          const block = state.blocks[id]
          if (!block) {
            logger.warn(`Cannot update dimensions: Block ${id} not found in workflow store`)
            return state // Return unchanged state
          }

          return {
            blocks: {
              ...state.blocks,
              [id]: {
                ...block,
                data: {
                  ...block.data,
                  width: dimensions.width,
                  height: dimensions.height,
                },
                layout: {
                  ...block.layout,
                  measuredWidth: dimensions.width,
                  measuredHeight: dimensions.height,
                },
              },
            },
            edges: [...state.edges],
          }
        })
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
        // On removal, clear the data JSON entirely per normalized DB contract
        const newData = !parentId
          ? {}
          : {
              ...block.data,
              parentId,
              extent,
            }

        // For removal we already set data to {}; for setting a parent keep as-is

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
        get().updateLastSaved()
        // Note: Socket.IO handles real-time sync automatically
      },

      addEdge: (edge: Edge) => {
        // Prevent connections to/from annotation-only blocks (non-executable)
        const sourceBlock = get().blocks[edge.source]
        const targetBlock = get().blocks[edge.target]

        if (isAnnotationOnlyBlock(sourceBlock?.type) || isAnnotationOnlyBlock(targetBlock?.type)) {
          return
        }

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

        const newEdge: Edge = {
          id: edge.id || crypto.randomUUID(),
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
          type: edge.type || 'default',
          data: edge.data || {},
        }

        const newEdges = [...get().edges, newEdge]

        const newState = {
          blocks: { ...get().blocks },
          edges: newEdges,
          loops: generateLoopBlocks(get().blocks),
          parallels: get().generateParallelBlocks(),
        }

        set(newState)
        get().updateLastSaved()
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
        get().updateLastSaved()
      },

      clear: () => {
        const newState = {
          blocks: {},
          edges: [],
          loops: {},
          parallels: {},
          lastSaved: Date.now(),
        }
        set(newState)
        // Note: Socket.IO handles real-time sync automatically
        return newState
      },

      updateLastSaved: () => {
        set({ lastSaved: Date.now() })
        // Note: Socket.IO handles real-time sync automatically
      },

      // Add method to get current workflow state (eliminates duplication in diff store)
      getWorkflowState: (): WorkflowState => {
        const state = get()
        return {
          blocks: state.blocks,
          edges: state.edges,
          loops: state.loops,
          parallels: state.parallels,
          lastSaved: state.lastSaved,
          isDeployed: state.isDeployed,
          deployedAt: state.deployedAt,
          deploymentStatuses: state.deploymentStatuses,
          needsRedeployment: state.needsRedeployment,
        }
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

        const newName = getUniqueBlockName(block.name, get().blocks)

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
        if (!oldBlock) return false

        // Check for normalized name collisions
        const normalizedNewName = normalizeBlockName(name)
        const currentBlocks = get().blocks

        // Find any other block with the same normalized name
        const conflictingBlock = Object.entries(currentBlocks).find(([blockId, block]) => {
          return (
            blockId !== id && // Different block
            block.name && // Has a name
            normalizeBlockName(block.name) === normalizedNewName // Same normalized name
          )
        })

        if (conflictingBlock) {
          // Don't allow the rename - another block already uses this normalized name
          logger.error(
            `Cannot rename block to "${name}" - another block "${conflictingBlock[1].name}" already uses the normalized name "${normalizedNewName}"`
          )
          return false
        }

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
        get().updateLastSaved()
        // Note: Socket.IO handles real-time sync automatically

        return true
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

      setBlockTriggerMode: (id: string, triggerMode: boolean) => {
        set((state) => ({
          blocks: {
            ...state.blocks,
            [id]: {
              ...state.blocks[id],
              triggerMode,
            },
          },
          edges: [...state.edges],
          loops: { ...state.loops },
        }))
        get().updateLastSaved()
        // Note: Socket.IO handles real-time sync automatically
      },

      updateBlockLayoutMetrics: (id: string, dimensions: { width: number; height: number }) => {
        set((state) => {
          const block = state.blocks[id]
          if (!block) {
            logger.warn(`Cannot update layout metrics: Block ${id} not found in workflow store`)
            return state
          }

          return {
            blocks: {
              ...state.blocks,
              [id]: {
                ...block,
                height: dimensions.height,
                layout: {
                  ...block.layout,
                  measuredWidth: dimensions.width,
                  measuredHeight: dimensions.height,
                },
              },
            },
            edges: [...state.edges],
            loops: { ...state.loops },
          }
        })
        get().updateLastSaved()
        // No sync needed for layout changes, just visual
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
                count: Math.max(1, Math.min(100, count)), // Clamp between 1-100
              },
            },
          }

          return {
            blocks: newBlocks,
            edges: [...state.edges],
            loops: generateLoopBlocks(newBlocks), // Regenerate loops
          }
        }),

      updateLoopType: (loopId: string, loopType: 'for' | 'forEach' | 'while' | 'doWhile') =>
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

      setLoopForEachItems: (loopId: string, items: any) =>
        set((state) => {
          const block = state.blocks[loopId]
          if (!block || block.type !== 'loop') return state

          const newBlocks = {
            ...state.blocks,
            [loopId]: {
              ...block,
              data: {
                ...block.data,
                collection: items ?? '',
              },
            },
          }

          return {
            blocks: newBlocks,
            edges: [...state.edges],
            loops: generateLoopBlocks(newBlocks),
          }
        }),

      setLoopWhileCondition: (loopId: string, condition: string) =>
        set((state) => {
          const block = state.blocks[loopId]
          if (!block || block.type !== 'loop') return state

          const newBlocks = {
            ...state.blocks,
            [loopId]: {
              ...block,
              data: {
                ...block.data,
                whileCondition: condition ?? '',
              },
            },
          }

          return {
            blocks: newBlocks,
            edges: [...state.edges],
            loops: generateLoopBlocks(newBlocks),
          }
        }),

      setLoopDoWhileCondition: (loopId: string, condition: string) =>
        set((state) => {
          const block = state.blocks[loopId]
          if (!block || block.type !== 'loop') return state

          const newBlocks = {
            ...state.blocks,
            [loopId]: {
              ...block,
              data: {
                ...block.data,
                doWhileCondition: condition ?? '',
              },
            },
          }

          return {
            blocks: newBlocks,
            edges: [...state.edges],
            loops: generateLoopBlocks(newBlocks),
          }
        }),

      updateLoopCollection: (loopId: string, collection: string) => {
        const store = get()
        const block = store.blocks[loopId]
        if (!block || block.type !== 'loop') return

        const loopType = block.data?.loopType || 'for'

        if (loopType === 'while') {
          store.setLoopWhileCondition(loopId, collection)
        } else if (loopType === 'doWhile') {
          store.setLoopDoWhileCondition(loopId, collection)
        } else if (loopType === 'forEach') {
          store.setLoopForEachItems(loopId, collection)
        } else {
          // Default to forEach-style storage for backward compatibility
          store.setLoopForEachItems(loopId, collection)
        }
      },

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

        get().updateLastSaved()

        // Call API to persist the revert to normalized tables
        try {
          const response = await fetch(
            `/api/workflows/${activeWorkflowId}/deployments/active/revert`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
            }
          )

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

        get().triggerUpdate()
        // Note: Socket.IO handles real-time sync automatically
      },

      toggleBlockTriggerMode: (id: string) => {
        const block = get().blocks[id]
        if (!block) return

        const newTriggerMode = !block.triggerMode

        // When switching TO trigger mode, check if block is inside a subflow
        if (newTriggerMode && TriggerUtils.isBlockInSubflow(id, get().blocks)) {
          logger.warn('Cannot enable trigger mode for block inside loop or parallel subflow', {
            blockId: id,
            blockType: block.type,
          })
          return
        }

        // When switching TO trigger mode, remove all incoming connections
        let filteredEdges = [...get().edges]
        if (newTriggerMode) {
          // Remove edges where this block is the target
          filteredEdges = filteredEdges.filter((edge) => edge.target !== id)
          logger.info(
            `Removed ${get().edges.length - filteredEdges.length} incoming connections for trigger mode`,
            {
              blockId: id,
              blockType: block.type,
            }
          )
        }

        const newState = {
          blocks: {
            ...get().blocks,
            [id]: {
              ...block,
              triggerMode: newTriggerMode,
            },
          },
          edges: filteredEdges,
          loops: { ...get().loops },
          parallels: { ...get().parallels },
        }

        set(newState)
        get().updateLastSaved()

        // Handle webhook enable/disable when toggling trigger mode
        const handleWebhookToggle = async () => {
          try {
            const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
            if (!activeWorkflowId) return

            // Check if there's a webhook for this block
            const response = await fetch(
              `/api/webhooks?workflowId=${activeWorkflowId}&blockId=${id}`
            )
            if (response.ok) {
              const data = await response.json()
              if (data.webhooks && data.webhooks.length > 0) {
                const webhook = data.webhooks[0].webhook

                // Update webhook's isActive status based on trigger mode
                const updateResponse = await fetch(`/api/webhooks/${webhook.id}`, {
                  method: 'PATCH',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    isActive: newTriggerMode,
                  }),
                })

                if (!updateResponse.ok) {
                  logger.error('Failed to update webhook status')
                }
              }
            }
          } catch (error) {
            logger.error('Error toggling webhook status:', error)
          }
        }

        // Handle webhook toggle asynchronously
        handleWebhookToggle()

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
              count: Math.max(1, Math.min(20, count)), // Clamp between 1-20
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
        get().updateLastSaved()
        // Note: Socket.IO handles real-time sync automatically
      },

      // Function to convert UI parallel blocks to execution format
      generateParallelBlocks: () => {
        return generateParallelBlocks(get().blocks)
      },

      setDragStartPosition: (position) => {
        set({ dragStartPosition: position })
      },

      getDragStartPosition: () => {
        return get().dragStartPosition || null
      },
    }),
    { name: 'workflow-store' }
  )
)
