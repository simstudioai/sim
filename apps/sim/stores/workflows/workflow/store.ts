import { Edge } from 'reactflow'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { getBlock } from '@/blocks'
import { resolveOutputType } from '@/blocks/utils'
import { createLogger } from '@/lib/logs/console-logger'
import { pushHistory, withHistory, WorkflowStoreWithHistory } from '../middleware'
import { saveWorkflowState } from '../persistence'
import { useWorkflowRegistry } from '../registry/store'
import { useSubBlockStore } from '../subblock/store'
import { markWorkflowsDirty, workflowSync } from '../sync'
import { mergeSubblockState } from '../utils'
import { Loop, Position, SubBlockState, SyncControl, WorkflowState } from './types'
import { detectCycle } from './utils'

const logger = createLogger('WorkflowStore')

const initialState = {
  blocks: {},
  edges: [],
  loops: {},
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
      state: { blocks: {}, edges: [], loops: {}, isDeployed: false, isPublished: false },
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

      addBlock: (id: string, type: string, name: string, position: Position) => {
        const blockConfig = getBlock(type)
        if (!blockConfig) return

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
            },
          },
          edges: [...get().edges],
          loops: { ...get().loops },
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

      removeBlock: (id: string) => {
        // First, clean up any subblock values for this block
        const subBlockStore = useSubBlockStore.getState()
        const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId

        const newState = {
          blocks: { ...get().blocks },
          edges: [...get().edges].filter((edge) => edge.source !== id && edge.target !== id),
          loops: { ...get().loops },
        }

        // Clean up subblock values before removing the block
        if (activeWorkflowId) {
          const updatedWorkflowValues = {
            ...(subBlockStore.workflowValues[activeWorkflowId] || {}),
          }
          delete updatedWorkflowValues[id]

          // Update subblock store
          useSubBlockStore.setState((state) => ({
            workflowValues: {
              ...state.workflowValues,
              [activeWorkflowId]: updatedWorkflowValues,
            },
          }))
        }

        // Clean up loops
        Object.entries(newState.loops).forEach(([loopId, loop]) => {
          if (loop.nodes.includes(id)) {
            // If removing this node would leave the loop empty, delete the loop
            if (loop.nodes.length <= 1) {
              delete newState.loops[loopId]
            } else {
              newState.loops[loopId] = {
                ...loop,
                nodes: loop.nodes.filter((nodeId) => nodeId !== id),
              }
            }
          }
        })

        // Delete the block last
        delete newState.blocks[id]

        set(newState)
        pushHistory(set, get, newState, 'Remove block')
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

        // Recalculate all loops after adding the edge
        const newLoops: Record<string, Loop> = {}
        const processedPaths = new Set<string>()
        const existingLoops = get().loops

        // Check for cycles from each node
        const nodes = new Set(newEdges.map((e) => e.source))
        nodes.forEach((node) => {
          const { paths } = detectCycle(newEdges, node)
          paths.forEach((path) => {
            // Create a canonical path representation for deduplication
            const canonicalPath = [...path].sort().join(',')
            if (!processedPaths.has(canonicalPath)) {
              processedPaths.add(canonicalPath)

              // Check if this path matches an existing loop
              let existingLoop: Loop | undefined
              Object.values(existingLoops).forEach((loop) => {
                const loopCanonicalPath = [...loop.nodes].sort().join(',')
                if (loopCanonicalPath === canonicalPath) {
                  existingLoop = loop
                }
              })

              if (existingLoop) {
                // Preserve the existing loop's properties
                newLoops[existingLoop.id] = {
                  ...existingLoop,
                  nodes: path, // Update nodes in case order changed
                }
              } else {
                // Create a new loop with default settings
                const loopId = crypto.randomUUID()
                newLoops[loopId] = {
                  id: loopId,
                  nodes: path,
                  iterations: 5,
                  loopType: 'for',
                  forEachItems: '',
                }
              }
            }
          })
        })

        const newState = {
          blocks: { ...get().blocks },
          edges: newEdges,
          loops: newLoops,
        }

        set(newState)
        pushHistory(set, get, newState, 'Add connection')
        get().updateLastSaved()
        get().sync.markDirty()
        get().sync.forceSync()
      },

      removeEdge: (edgeId: string) => {
        const newEdges = get().edges.filter((edge) => edge.id !== edgeId)

        // Recalculate all loops after edge removal
        const newLoops: Record<string, Loop> = {}
        const processedPaths = new Set<string>()
        const existingLoops = get().loops

        // Check for cycles from each node
        const nodes = new Set(newEdges.map((e) => e.source))
        nodes.forEach((node) => {
          const { paths } = detectCycle(newEdges, node)
          paths.forEach((path) => {
            // Create a canonical path representation for deduplication
            const canonicalPath = [...path].sort().join(',')
            if (!processedPaths.has(canonicalPath)) {
              processedPaths.add(canonicalPath)

              // Check if this path matches an existing loop
              let existingLoop: Loop | undefined
              Object.values(existingLoops).forEach((loop) => {
                const loopCanonicalPath = [...loop.nodes].sort().join(',')
                if (loopCanonicalPath === canonicalPath) {
                  existingLoop = loop
                }
              })

              if (existingLoop) {
                // Preserve the existing loop's properties
                newLoops[existingLoop.id] = {
                  ...existingLoop,
                  nodes: path, // Update nodes in case order changed
                }
              } else {
                // Create a new loop with default settings
                const loopId = crypto.randomUUID()
                newLoops[loopId] = {
                  id: loopId,
                  nodes: path,
                  iterations: 5,
                  loopType: 'for',
                  forEachItems: '',
                }
              }
            }
          })
        })

        const newState = {
          blocks: { ...get().blocks },
          edges: newEdges,
          loops: newLoops,
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
          saveWorkflowState(activeWorkflowId, {
            blocks: currentState.blocks,
            edges: currentState.edges,
            loops: currentState.loops,
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
        const newName =
          match && match[2] ? `${match[1]}${parseInt(match[2]) + 1}` : `${block.name} 1`

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
          loops: { ...get().loops },
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
          loops: { ...get().loops },
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
        }))
        get().updateLastSaved()
        // No sync needed for height changes, just visual
      },

      updateLoopIterations: (loopId: string, iterations: number) => {
        const newState = {
          blocks: { ...get().blocks },
          edges: [...get().edges],
          loops: {
            ...get().loops,
            [loopId]: {
              ...get().loops[loopId],
              iterations: Math.max(1, Math.min(50, iterations)), // Clamp between 1-50
            },
          },
        }

        set(newState)
        pushHistory(set, get, newState, 'Update loop iterations')
        get().updateLastSaved()
        get().sync.markDirty()
        get().sync.forceSync()
      },

      updateLoopType: (loopId: string, loopType: Loop['loopType']) => {
        const newState = {
          blocks: { ...get().blocks },
          edges: [...get().edges],
          loops: {
            ...get().loops,
            [loopId]: {
              ...get().loops[loopId],
              loopType,
            },
          },
        }

        set(newState)
        pushHistory(set, get, newState, 'Update loop type')
        get().updateLastSaved()
        get().sync.markDirty()
        get().sync.forceSync()
      },

      updateLoopForEachItems: (loopId: string, items: string) => {
        const newState = {
          blocks: { ...get().blocks },
          edges: [...get().edges],
          loops: {
            ...get().loops,
            [loopId]: {
              ...get().loops[loopId],
              forEachItems: items,
            },
          },
        }

        set(newState)
        pushHistory(set, get, newState, 'Update forEach items')
        get().updateLastSaved()
        get().sync.markDirty()
        get().sync.forceSync()
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
          : null;
        
        const newState = {
          blocks: deployedState.blocks,
          edges: deployedState.edges,
          loops: deployedState.loops,
          // Legacy fields for backward compatibility
          isDeployed: true,
          needsRedeployment: false,
          hasActiveWebhook: false, // Reset webhook status
          // Keep existing deployment statuses and update for the active workflow if needed
          deploymentStatuses: {
            ...get().deploymentStatuses,
            ...(activeWorkflowId && deploymentStatus ? {
              [activeWorkflowId]: deploymentStatus
            } : {})
          }
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
                [id]: updatedValues
              }
            }
          })
        }
        
        get().triggerUpdate()
        get().sync.markDirty()
        get().sync.forceSync()
      },
    })),
    { name: 'workflow-store' }
  )
)
