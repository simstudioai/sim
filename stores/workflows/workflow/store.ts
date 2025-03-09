import { Edge } from 'reactflow'
import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { getBlock } from '@/blocks'
import { resolveOutputType } from '@/blocks/utils'
import { WorkflowStoreWithHistory, pushHistory, withHistory } from '../middleware'
import { useWorkflowRegistry } from '../registry/store'
import { useSubBlockStore } from '../subblock/store'
import { mergeSubblockState } from '../utils'
import { detectCycle } from '../utils'
import { Loop, Position, SubBlockState } from './types'

// Create a localStorage key for the workflow store
const STORAGE_KEY = 'workflow-store'

const initialState = {
  blocks: {},
  edges: [],
  loops: {},
  lastSaved: undefined,
  isDeployed: false,
  deployedAt: undefined,
  history: {
    past: [],
    present: {
      state: { blocks: {}, edges: [], loops: {}, isDeployed: false },
      timestamp: Date.now(),
      action: 'Initial state',
      subblockValues: {},
    },
    future: [],
  },
}

export const useWorkflowStore = create<WorkflowStoreWithHistory>()(
  devtools(
    persist(
      withHistory((set, get) => ({
        ...initialState,
        undo: () => {},
        redo: () => {},
        canUndo: () => false,
        canRedo: () => false,
        revertToHistoryState: () => {},

        // Clear the store state
        clear: () => {
          set(initialState)
        },

        // Update the last saved timestamp
        updateLastSaved: () => {
          set({ lastSaved: Date.now() })
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
          // get().saveWorkflowToDB()
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

          // No immediate sync for position updates as they happen frequently during dragging
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
              if (loop.nodes.length <= 2) {
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
          // get().saveWorkflowToDB()
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

          // Check for cycles from each node
          const nodes = new Set(newEdges.map((e) => e.source))
          nodes.forEach((node) => {
            const { paths } = detectCycle(newEdges, node)
            paths.forEach((path) => {
              // Create a canonical path representation for deduplication
              const canonicalPath = [...path].sort().join(',')
              if (!processedPaths.has(canonicalPath)) {
                const loopId = crypto.randomUUID()
                newLoops[loopId] = {
                  id: loopId,
                  nodes: path,
                  maxIterations: 5,
                  minIterations: 0,
                }
                processedPaths.add(canonicalPath)
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
          // get().saveWorkflowToDB()
        },

        removeEdge: (edgeId: string) => {
          const newEdges = get().edges.filter((edge) => edge.id !== edgeId)

          // Recalculate all loops after edge removal
          const newLoops: Record<string, Loop> = {}
          const processedPaths = new Set<string>()

          // Check for cycles from each node
          const nodes = new Set(newEdges.map((e) => e.source))
          nodes.forEach((node) => {
            const { paths } = detectCycle(newEdges, node)
            paths.forEach((path) => {
              // Create a canonical path representation for deduplication
              const canonicalPath = [...path].sort().join(',')
              if (!processedPaths.has(canonicalPath)) {
                const loopId = crypto.randomUUID()
                newLoops[loopId] = {
                  id: loopId,
                  nodes: path,
                  maxIterations: 5,
                  minIterations: 0,
                }
                processedPaths.add(canonicalPath)
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
          // get().saveWorkflowToDB()
        },

        toggleBlockEnabled: (id: string) => {
          const block = get().blocks[id]
          if (!block) return

          const newState = {
            blocks: {
              ...get().blocks,
              [id]: {
                ...block,
                enabled: !block.enabled,
              },
            },
            edges: [...get().edges],
            loops: { ...get().loops },
          }

          set(newState)
          pushHistory(set, get, newState, `${block.enabled ? 'Disable' : 'Enable'} block`)
          get().updateLastSaved()
          // get().saveWorkflowToDB()
        },

        duplicateBlock: (id: string) => {
          const block = get().blocks[id]
          if (!block) return

          const newId = crypto.randomUUID()
          const newPosition = {
            x: block.position.x + 20,
            y: block.position.y + 20,
          }

          // Deep clone subblocks
          const subBlocks: Record<string, SubBlockState> = {}
          Object.entries(block.subBlocks).forEach(([subBlockId, subBlock]) => {
            subBlocks[subBlockId] = {
              ...subBlock,
            }
          })

          const newState = {
            blocks: {
              ...get().blocks,
              [newId]: {
                ...block,
                id: newId,
                position: newPosition,
                subBlocks,
              },
            },
            edges: [...get().edges],
            loops: { ...get().loops },
          }

          set(newState)
          pushHistory(set, get, newState, `Duplicate ${block.type} block`)
          get().updateLastSaved()
          // get().saveWorkflowToDB()
        },

        toggleBlockHandles: (id: string) => {
          const block = get().blocks[id]
          if (!block) return

          const newState = {
            blocks: {
              ...get().blocks,
              [id]: {
                ...block,
                horizontalHandles: !block.horizontalHandles,
              },
            },
            edges: [...get().edges],
            loops: { ...get().loops },
          }

          set(newState)
          pushHistory(
            set,
            get,
            newState,
            `Switch to ${block.horizontalHandles ? 'vertical' : 'horizontal'} handles`
          )
          get().updateLastSaved()
          // get().saveWorkflowToDB()
        },

        updateBlockName: (id: string, name: string) => {
          const block = get().blocks[id]
          if (!block) return

          const newState = {
            blocks: {
              ...get().blocks,
              [id]: {
                ...block,
                name,
              },
            },
            edges: [...get().edges],
            loops: { ...get().loops },
          }

          set(newState)
          pushHistory(set, get, newState, `Rename block to ${name}`)
          get().updateLastSaved()
          // get().saveWorkflowToDB()
        },

        toggleBlockWide: (id: string) => {
          const block = get().blocks[id]
          if (!block) return

          const newState = {
            blocks: {
              ...get().blocks,
              [id]: {
                ...block,
                isWide: !block.isWide,
              },
            },
            edges: [...get().edges],
            loops: { ...get().loops },
          }

          set(newState)
          pushHistory(set, get, newState, `${block.isWide ? 'Narrow' : 'Widen'} block`)
          get().updateLastSaved()
          // get().saveWorkflowToDB()
        },

        updateBlockHeight: (id: string, height: number) => {
          const block = get().blocks[id]
          if (!block) return

          const newState = {
            blocks: {
              ...get().blocks,
              [id]: {
                ...block,
                height,
              },
            },
            edges: [...get().edges],
            loops: { ...get().loops },
          }

          set(newState)
          get().updateLastSaved()
          // No history push for height changes as they're frequent
          // No sync for height changes as they're frequent and not critical
        },

        updateLoopMaxIterations: (loopId: string, maxIterations: number) => {
          const loop = get().loops[loopId]
          if (!loop) return

          const newState = {
            blocks: { ...get().blocks },
            edges: [...get().edges],
            loops: {
              ...get().loops,
              [loopId]: {
                ...loop,
                maxIterations,
              },
            },
          }

          set(newState)
          pushHistory(set, get, newState, `Set max iterations to ${maxIterations}`)
          get().updateLastSaved()
          // get().saveWorkflowToDB()
        },

        updateLoopMinIterations: (loopId: string, minIterations: number) => {
          const loop = get().loops[loopId]
          if (!loop) return

          const newState = {
            blocks: { ...get().blocks },
            edges: [...get().edges],
            loops: {
              ...get().loops,
              [loopId]: {
                ...loop,
                minIterations,
              },
            },
          }

          set(newState)
          pushHistory(set, get, newState, `Set min iterations to ${minIterations}`)
          get().updateLastSaved()
          // get().saveWorkflowToDB()
        },

        triggerUpdate: () => {
          set({ update: Date.now() })
        },

        setDeploymentStatus: (isDeployed: boolean, deployedAt?: Date) => {
          set({
            isDeployed,
            deployedAt,
          })

          get().updateLastSaved()
        },
      })),
      {
        name: STORAGE_KEY,
        // Only persist these fields
        partialize: (state) => ({
          blocks: state.blocks,
          edges: state.edges,
          loops: state.loops,
          isDeployed: state.isDeployed,
          deployedAt: state.deployedAt,
          lastSaved: state.lastSaved,
        }),
      }
    ),
    { name: 'workflow-store' }
  )
)
