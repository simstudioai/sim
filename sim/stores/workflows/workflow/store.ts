import { Edge } from 'reactflow'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { getBlock } from '@/blocks'
import { resolveOutputType } from '@/blocks/utils'
import { pushHistory, withHistory, WorkflowStoreWithHistory } from '../middleware'
import { saveWorkflowState } from '../persistence'
import { useWorkflowRegistry } from '../registry/store'
import { useSubBlockStore } from '../subblock/store'
import { workflowSync } from '../sync'
import { mergeSubblockState } from '../utils'
import { Loop, Position, SubBlockState } from './types'
import { detectCycle } from './utils'

const initialState = {
  blocks: {},
  edges: [],
  loops: {},
  lastSaved: undefined,
  isDeployed: false,
  deployedAt: undefined,
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

export const useWorkflowStore = create<WorkflowStoreWithHistory>()(
  devtools(
    withHistory((set, get) => ({
      ...initialState,
      undo: () => {},
      redo: () => {},
      canUndo: () => false,
      canRedo: () => false,
      revertToHistoryState: () => {},

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
        workflowSync.sync()
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
        workflowSync.sync()
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
                  nodes: path // Update nodes in case order changed
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
        workflowSync.sync()
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
                  nodes: path // Update nodes in case order changed
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
        workflowSync.sync()
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
        workflowSync.sync()

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
            isDeployed: currentState.isDeployed,
            deployedAt: currentState.deployedAt,
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
        workflowSync.sync()
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
        workflowSync.sync()
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
        workflowSync.sync()
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
        workflowSync.sync()
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
        workflowSync.sync()
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
        workflowSync.sync()
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
        workflowSync.sync()
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
        workflowSync.sync()
      },

      triggerUpdate: () => {
        set((state) => ({
          ...state,
          lastUpdate: Date.now(),
        }))
      },

      setDeploymentStatus: (isDeployed: boolean, deployedAt?: Date) => {
        const newState = {
          ...get(),
          isDeployed,
          deployedAt: deployedAt || (isDeployed ? new Date() : undefined),
          needsRedeployment: isDeployed ? false : get().needsRedeployment,
        }

        set(newState)
        get().updateLastSaved()
        workflowSync.sync()
      },

      setScheduleStatus: (hasActiveSchedule: boolean) => {
        // Only update if the status has changed to avoid unnecessary rerenders
        if (get().hasActiveSchedule !== hasActiveSchedule) {
          set({ hasActiveSchedule })
          get().updateLastSaved()
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
        }
      },
    })),
    { name: 'workflow-store' }
  )
)
