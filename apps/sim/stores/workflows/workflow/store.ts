import type { Edge } from 'reactflow'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { getBlock } from '@/blocks'
import { resolveOutputType } from '@/blocks/utils'
import { pushHistory, type WorkflowStoreWithHistory, withHistory } from '../middleware'
import { saveWorkflowState } from '../persistence'
import { useWorkflowRegistry } from '../registry/store'
import { useSubBlockStore } from '../subblock/store'
import { markWorkflowsDirty, workflowSync } from '../sync'
import { mergeSubblockState } from '../utils'
import type { Position, SubBlockState, SyncControl, WorkflowState } from './types'
import { generateLoopBlocks, generateParallelBlocks } from './utils'

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
  hasActiveSchedule: false,
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
 * The SyncControl implementation provides a clean, centralized way to handle workflow syncing.
 *
 * This pattern offers several advantages:
 * 1. It encapsulates sync logic through a clear, standardized interface
 * 2. It allows components to mark workflows as dirty without direct dependencies
 * 3. It prevents race conditions by ensuring changes are properly tracked before syncing
 * 4. It centralizes sync decisions to avoid redundant or conflicting operations
 *
 * Usage:
 * - Call markDirty() when workflow state changes but sync can be deferred
 * - Call forceSync() when an immediate sync to the server is needed
 * - Use isDirty() to check if there are unsaved changes
 */
const createSyncControl = (): SyncControl => ({
  markDirty: () => {
    markWorkflowsDirty()
  },
  isDirty: () => {
    // This calls into the sync module to check dirty status
    // Actual implementation in sync.ts
    return true // Always return true as the sync module will do the actual checking
  },
  forceSync: () => {
    markWorkflowsDirty() // Always mark as dirty before forcing a sync
    workflowSync.sync()
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
          workflowSync.sync()
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

        const outputs = resolveOutputType(blockConfig.outputs, subBlocks)

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
        get().sync.markDirty()
        get().sync.forceSync()
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

        // No sync here as this is a frequent operation during dragging
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
        workflowSync.sync()
      },

      updateParentId: (id: string, parentId: string, extent: 'parent') => {
        const block = get().blocks[id]
        if (!block) {
          console.warn(`Cannot set parent: Block ${id} not found`)
          return
        }

        console.log('UpdateParentId called:', {
          blockId: id,
          blockName: block.name,
          blockType: block.type,
          newParentId: parentId,
          extent,
          currentParentId: block.data?.parentId,
        })

        // Skip if the parent ID hasn't changed
        if (block.data?.parentId === parentId) {
          console.log('Parent ID unchanged, skipping update')
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

        console.log('[WorkflowStore/updateParentId] Updated parentId relationship:', {
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
        workflowSync.sync()
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

        console.log('[WorkflowStore/removeBlock] Found blocks to remove:', {
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
        get().sync.markDirty()
        get().sync.forceSync()
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

        // Use the new loop generation approach
        const newState = {
          blocks: { ...get().blocks },
          edges: newEdges,
          loops: generateLoopBlocks(get().blocks),
          parallels: get().generateParallelBlocks(),
        }

        set(newState)
        pushHistory(set, get, newState, 'Add connection')
        get().updateLastSaved()
        get().sync.markDirty()
        get().sync.forceSync()
      },

      removeEdge: (edgeId: string) => {
        // Validate the edge exists
        const edgeToRemove = get().edges.find((edge) => edge.id === edgeId)
        if (!edgeToRemove) {
          console.warn(`Attempted to remove non-existent edge: ${edgeId}`)
          return
        }

        const newEdges = get().edges.filter((edge) => edge.id !== edgeId)

        // Use the new loop generation approach instead of cycle detection
        const newState = {
          blocks: { ...get().blocks },
          edges: newEdges,
          loops: generateLoopBlocks(get().blocks),
          parallels: get().generateParallelBlocks(),
        }

        set(newState)
        pushHistory(set, get, newState, 'Remove connection')
        get().updateLastSaved()
        get().sync.markDirty()
        get().sync.forceSync()
      },

      clear: () => {
        const newState = {
          blocks: {},
          edges: [],
          loops: {},
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
          hasActiveSchedule: false,
          hasActiveWebhook: false,
        }
        set(newState)
        get().sync.markDirty()
        get().sync.forceSync()

        return newState
      },

      updateLastSaved: () => {
        set({ lastSaved: Date.now() })

        // Save current state to localStorage
        const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
        if (activeWorkflowId) {
          const currentState = get()
          const generatedLoops = currentState.generateLoopBlocks()
          saveWorkflowState(activeWorkflowId, {
            blocks: currentState.blocks,
            edges: currentState.edges,
            loops: generatedLoops,
            history: currentState.history,
            // Include both legacy and new deployment status fields
            isDeployed: currentState.isDeployed,
            deployedAt: currentState.deployedAt,
            deploymentStatuses: currentState.deploymentStatuses,
            lastSaved: Date.now(),
          })

          // Note: Scheduling changes are automatically handled by the workflowSync
          // When the workflow is synced to the database, the sync system checks if
          // the starter block has scheduling enabled and updates or cancels the
          // schedule accordingly.
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
        }

        set(newState)
        get().updateLastSaved()
        get().sync.markDirty()
        get().sync.forceSync()
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
        get().sync.markDirty()
        get().sync.forceSync()
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
        get().sync.markDirty()
        get().sync.forceSync()
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

          // Loop through blocks
          Object.entries(workflowValues).forEach(([blockId, blockValues]) => {
            if (blockId === id) return // Skip the block being renamed

            // Loop through subblocks and update references
            Object.entries(blockValues).forEach(([subBlockId, value]) => {
              const oldBlockName = oldBlock.name.replace(/\s+/g, '').toLowerCase()
              const newBlockName = name.replace(/\s+/g, '').toLowerCase()
              const regex = new RegExp(`<${oldBlockName}\\.`, 'g')

              // Use a recursive function to handle all object types
              updatedWorkflowValues[blockId][subBlockId] = updateReferences(
                value,
                regex,
                `<${newBlockName}.`
              )

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
        }

        set(newState)
        pushHistory(set, get, newState, `${name} block name updated`)
        get().updateLastSaved()
        get().sync.markDirty()
        get().sync.forceSync()
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
        get().sync.markDirty()
        get().sync.forceSync()
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

      setScheduleStatus: (hasActiveSchedule: boolean) => {
        // Only update if the status has changed to avoid unnecessary rerenders
        if (get().hasActiveSchedule !== hasActiveSchedule) {
          set({ hasActiveSchedule })
          get().updateLastSaved()
          get().sync.markDirty()
        }
      },

      setWebhookStatus: (hasActiveWebhook: boolean) => {
        // Only update if the status has changed to avoid unnecessary rerenders
        if (get().hasActiveWebhook !== hasActiveWebhook) {
          // If the workflow has an active schedule, disable it
          if (get().hasActiveSchedule) {
            get().setScheduleStatus(false)
          }

          set({ hasActiveWebhook })
          get().updateLastSaved()
          get().sync.markDirty()
        }
      },

      revertToDeployedState: (deployedState: WorkflowState) => {
        const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId

        // Preserving the workflow-specific deployment status if it exists
        const deploymentStatus = activeWorkflowId
          ? useWorkflowRegistry.getState().getWorkflowDeploymentStatus(activeWorkflowId)
          : null

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
            ...(activeWorkflowId && deploymentStatus
              ? {
                  [activeWorkflowId]: deploymentStatus,
                }
              : {}),
          },
        }

        // Update the main workflow state
        set(newState)

        // Get the active workflow ID
        if (!activeWorkflowId) return

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
        get().sync.markDirty()
        get().sync.forceSync()
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
            // Switching TO advanced mode, clear system prompt and context (basic mode fields)
            updatedValues.systemPrompt = null
            updatedValues.context = null
          } else {
            // Switching TO basic mode, clear messages (advanced mode field)
            updatedValues.messages = null
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
        get().sync.markDirty()
        get().sync.forceSync()
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
        get().sync.markDirty()
        get().sync.forceSync()
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
        get().sync.markDirty()
        get().sync.forceSync()
      },

      // Function to convert UI parallel blocks to execution format
      generateParallelBlocks: () => {
        return generateParallelBlocks(get().blocks)
      },
    })),
    { name: 'workflow-store' }
  )
)
