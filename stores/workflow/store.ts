import { Edge } from 'reactflow'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { getBlock } from '@/blocks'
import { resolveOutputType } from '@/blocks/utils'
import { WorkflowStoreWithHistory, pushHistory, withHistory } from './middleware'
import { useWorkflowRegistry } from './registry/store'
import { useSubBlockStore } from './subblock/store'
import { Loop, Position, SubBlockState } from './types'
import { detectCycle } from './utils'

const initialState = {
  blocks: {},
  edges: [],
  loops: {},
  lastSaved: undefined,
  history: {
    past: [],
    present: {
      state: { blocks: {}, edges: [], loops: {} },
      timestamp: Date.now(),
      action: 'Initial state',
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
      },

      clear: () => {
        const newState = {
          blocks: {},
          edges: [],
          loops: {},
          history: {
            past: [],
            present: {
              state: { blocks: {}, edges: [], loops: {} },
              timestamp: Date.now(),
              action: 'Initial state',
            },
            future: [],
          },
          lastSaved: Date.now(),
        }
        set(newState)
        return newState
      },

      updateLastSaved: () => {
        set({ lastSaved: Date.now() })
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

        const newSubBlocks = Object.entries(block.subBlocks).reduce(
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

        set(newState)
        pushHistory(set, get, newState, `Duplicate ${block.type} block`)
        get().updateLastSaved()
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
      },

      updateBlockName: (id: string, name: string) => {
        const newState = {
          blocks: {
            ...get().blocks,
            [id]: {
              ...get().blocks[id],
              name,
            },
          },
          edges: [...get().edges],
          loops: { ...get().loops },
        }

        set(newState)
        pushHistory(set, get, newState, `${name} block name updated`)
        get().updateLastSaved()
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

      updateLoopMaxIterations: (loopId: string, maxIterations: number) => {
        const newState = {
          blocks: { ...get().blocks },
          edges: [...get().edges],
          loops: {
            ...get().loops,
            [loopId]: {
              ...get().loops[loopId],
              maxIterations: Math.max(1, Math.min(50, maxIterations)), // Clamp between 1-50
            },
          },
        }

        set(newState)
        pushHistory(set, get, newState, 'Update loop max iterations')
        get().updateLastSaved()
      },

      triggerUpdate: () => {
        set((state) => ({
          ...state,
          lastUpdate: Date.now(),
        }))
      },
    })),
    { name: 'workflow-store' }
  )
)
