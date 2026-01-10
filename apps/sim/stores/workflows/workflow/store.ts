import { createLogger } from '@sim/logger'
import type { Edge } from 'reactflow'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { DEFAULT_DUPLICATE_OFFSET } from '@/lib/workflows/autolayout/constants'
import { getBlockOutputs } from '@/lib/workflows/blocks/block-outputs'
import { TriggerUtils } from '@/lib/workflows/triggers/triggers'
import { getBlock } from '@/blocks'
import type { SubBlockConfig } from '@/blocks/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { getUniqueBlockName, mergeSubblockState, normalizeName } from '@/stores/workflows/utils'
import type {
  Position,
  SubBlockState,
  WorkflowState,
  WorkflowStore,
} from '@/stores/workflows/workflow/types'
import {
  generateLoopBlocks,
  generateParallelBlocks,
  wouldCreateCycle,
} from '@/stores/workflows/workflow/utils'

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

      updateNodeDimensions: (id: string, dimensions: { width: number; height: number }) => {
        set((state) => {
          const block = state.blocks[id]
          if (!block) {
            logger.warn(`Cannot update dimensions: Block ${id} not found in workflow store`)
            return state
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
      },

      batchUpdateBlocksWithParent: (
        updates: Array<{
          id: string
          position: { x: number; y: number }
          parentId?: string
        }>
      ) => {
        const currentBlocks = get().blocks
        const newBlocks = { ...currentBlocks }

        for (const update of updates) {
          const block = newBlocks[update.id]
          if (!block) continue

          // Compute new data based on whether we're adding or removing a parent
          let newData = block.data
          if (update.parentId) {
            // Adding/changing parent - set parentId and extent
            newData = { ...block.data, parentId: update.parentId, extent: 'parent' as const }
          } else if (block.data?.parentId) {
            // Removing parent - clear parentId and extent
            const { parentId: _removed, extent: _removedExtent, ...restData } = block.data
            newData = restData
          }

          newBlocks[update.id] = {
            ...block,
            position: update.position,
            data: newData,
          }
        }

        set({
          blocks: newBlocks,
          edges: [...get().edges],
          loops: generateLoopBlocks(newBlocks),
          parallels: generateParallelBlocks(newBlocks),
        })
      },

      batchUpdatePositions: (updates: Array<{ id: string; position: Position }>) => {
        const newBlocks = { ...get().blocks }
        for (const { id, position } of updates) {
          if (newBlocks[id]) {
            newBlocks[id] = { ...newBlocks[id], position }
          }
        }
        set({ blocks: newBlocks })
      },

      batchAddBlocks: (
        blocks: Array<{
          id: string
          type: string
          name: string
          position: Position
          subBlocks: Record<string, SubBlockState>
          outputs: Record<string, any>
          enabled: boolean
          horizontalHandles?: boolean
          advancedMode?: boolean
          triggerMode?: boolean
          height?: number
          data?: Record<string, any>
        }>,
        edges?: Edge[],
        subBlockValues?: Record<string, Record<string, unknown>>
      ) => {
        const currentBlocks = get().blocks
        const currentEdges = get().edges
        const newBlocks = { ...currentBlocks }
        const newEdges = [...currentEdges]

        for (const block of blocks) {
          newBlocks[block.id] = {
            id: block.id,
            type: block.type,
            name: block.name,
            position: block.position,
            subBlocks: block.subBlocks,
            outputs: block.outputs,
            enabled: block.enabled ?? true,
            horizontalHandles: block.horizontalHandles ?? true,
            advancedMode: block.advancedMode ?? false,
            triggerMode: block.triggerMode ?? false,
            height: block.height ?? 0,
            data: block.data,
          }
        }

        if (edges && edges.length > 0) {
          const existingEdgeIds = new Set(currentEdges.map((e) => e.id))
          for (const edge of edges) {
            if (!existingEdgeIds.has(edge.id)) {
              newEdges.push({
                id: edge.id || crypto.randomUUID(),
                source: edge.source,
                target: edge.target,
                sourceHandle: edge.sourceHandle,
                targetHandle: edge.targetHandle,
                type: edge.type || 'default',
                data: edge.data || {},
              })
            }
          }
        }

        set({
          blocks: newBlocks,
          edges: newEdges,
          loops: generateLoopBlocks(newBlocks),
          parallels: generateParallelBlocks(newBlocks),
        })

        if (subBlockValues && Object.keys(subBlockValues).length > 0) {
          const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
          if (activeWorkflowId) {
            const subBlockStore = useSubBlockStore.getState()
            const updatedWorkflowValues = {
              ...(subBlockStore.workflowValues[activeWorkflowId] || {}),
            }

            for (const [blockId, values] of Object.entries(subBlockValues)) {
              updatedWorkflowValues[blockId] = {
                ...(updatedWorkflowValues[blockId] || {}),
                ...values,
              }
            }

            useSubBlockStore.setState((state) => ({
              workflowValues: {
                ...state.workflowValues,
                [activeWorkflowId]: updatedWorkflowValues,
              },
            }))
          }
        }

        get().updateLastSaved()
      },

      batchRemoveBlocks: (ids: string[]) => {
        const currentBlocks = get().blocks
        const currentEdges = get().edges
        const newBlocks = { ...currentBlocks }

        const blocksToRemove = new Set<string>(ids)

        const findAllDescendants = (parentId: string) => {
          Object.entries(newBlocks).forEach(([blockId, block]) => {
            if (block.data?.parentId === parentId) {
              blocksToRemove.add(blockId)
              findAllDescendants(blockId)
            }
          })
        }

        for (const id of ids) {
          findAllDescendants(id)
        }

        const newEdges = currentEdges.filter(
          (edge) => !blocksToRemove.has(edge.source) && !blocksToRemove.has(edge.target)
        )

        blocksToRemove.forEach((blockId) => {
          delete newBlocks[blockId]
        })

        const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
        if (activeWorkflowId) {
          const subBlockStore = useSubBlockStore.getState()
          if (subBlockStore.workflowValues[activeWorkflowId]) {
            const updatedWorkflowValues = {
              ...subBlockStore.workflowValues[activeWorkflowId],
            }

            blocksToRemove.forEach((blockId) => {
              delete updatedWorkflowValues[blockId]
            })

            useSubBlockStore.setState((state) => ({
              workflowValues: {
                ...state.workflowValues,
                [activeWorkflowId]: updatedWorkflowValues,
              },
            }))
          }
        }

        set({
          blocks: newBlocks,
          edges: newEdges,
          loops: generateLoopBlocks(newBlocks),
          parallels: generateParallelBlocks(newBlocks),
        })

        get().updateLastSaved()
      },

      batchToggleEnabled: (ids: string[]) => {
        const newBlocks = { ...get().blocks }
        for (const id of ids) {
          if (newBlocks[id]) {
            newBlocks[id] = { ...newBlocks[id], enabled: !newBlocks[id].enabled }
          }
        }
        set({ blocks: newBlocks, edges: [...get().edges] })
        get().updateLastSaved()
      },

      batchToggleHandles: (ids: string[]) => {
        const newBlocks = { ...get().blocks }
        for (const id of ids) {
          if (newBlocks[id]) {
            newBlocks[id] = {
              ...newBlocks[id],
              horizontalHandles: !newBlocks[id].horizontalHandles,
            }
          }
        }
        set({ blocks: newBlocks, edges: [...get().edges] })
        get().updateLastSaved()
      },

      batchAddEdges: (edges: Edge[]) => {
        const currentEdges = get().edges
        const newEdges = [...currentEdges]
        const existingEdgeIds = new Set(currentEdges.map((e) => e.id))
        // Track existing connections to prevent duplicates (same source->target)
        const existingConnections = new Set(currentEdges.map((e) => `${e.source}->${e.target}`))

        for (const edge of edges) {
          // Skip if edge ID already exists
          if (existingEdgeIds.has(edge.id)) continue

          // Skip self-referencing edges
          if (edge.source === edge.target) continue

          // Skip if connection already exists (same source and target)
          const connectionKey = `${edge.source}->${edge.target}`
          if (existingConnections.has(connectionKey)) continue

          // Skip if would create a cycle
          if (wouldCreateCycle([...newEdges], edge.source, edge.target)) continue

          newEdges.push({
            id: edge.id || crypto.randomUUID(),
            source: edge.source,
            target: edge.target,
            sourceHandle: edge.sourceHandle,
            targetHandle: edge.targetHandle,
            type: edge.type || 'default',
            data: edge.data || {},
          })
          existingEdgeIds.add(edge.id)
          existingConnections.add(connectionKey)
        }

        const blocks = get().blocks
        set({
          blocks: { ...blocks },
          edges: newEdges,
          loops: generateLoopBlocks(blocks),
          parallels: generateParallelBlocks(blocks),
        })

        get().updateLastSaved()
      },

      batchRemoveEdges: (ids: string[]) => {
        const idsSet = new Set(ids)
        const newEdges = get().edges.filter((e) => !idsSet.has(e.id))
        const blocks = get().blocks

        set({
          blocks: { ...blocks },
          edges: newEdges,
          loops: generateLoopBlocks(blocks),
          parallels: generateParallelBlocks(blocks),
        })

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
        return newState
      },

      updateLastSaved: () => {
        set({ lastSaved: Date.now() })
      },

      getWorkflowState: (): WorkflowState => {
        const state = get()
        return {
          blocks: state.blocks,
          edges: state.edges,
          loops: state.loops,
          parallels: state.parallels,
          lastSaved: state.lastSaved,
          deploymentStatuses: state.deploymentStatuses,
          needsRedeployment: state.needsRedeployment,
        }
      },
      replaceWorkflowState: (
        workflowState: WorkflowState,
        options?: { updateLastSaved?: boolean }
      ) => {
        set((state) => {
          const nextBlocks = workflowState.blocks || {}
          const nextEdges = workflowState.edges || []
          const nextLoops =
            Object.keys(workflowState.loops || {}).length > 0
              ? workflowState.loops
              : generateLoopBlocks(nextBlocks)
          const nextParallels =
            Object.keys(workflowState.parallels || {}).length > 0
              ? workflowState.parallels
              : generateParallelBlocks(nextBlocks)

          return {
            ...state,
            blocks: nextBlocks,
            edges: nextEdges,
            loops: nextLoops,
            parallels: nextParallels,
            deploymentStatuses: workflowState.deploymentStatuses || state.deploymentStatuses,
            needsRedeployment:
              workflowState.needsRedeployment !== undefined
                ? workflowState.needsRedeployment
                : state.needsRedeployment,
            lastSaved:
              options?.updateLastSaved === true
                ? Date.now()
                : (workflowState.lastSaved ?? state.lastSaved),
          }
        })
      },

      setBlockEnabled: (id: string, enabled: boolean) => {
        const block = get().blocks[id]
        if (!block || block.enabled === enabled) return

        const newState = {
          blocks: {
            ...get().blocks,
            [id]: {
              ...block,
              enabled,
            },
          },
          edges: [...get().edges],
          loops: { ...get().loops },
          parallels: { ...get().parallels },
        }

        set(newState)
        get().updateLastSaved()
      },

      duplicateBlock: (id: string) => {
        const block = get().blocks[id]
        if (!block) return

        const newId = crypto.randomUUID()
        const offsetPosition = {
          x: block.position.x + DEFAULT_DUPLICATE_OFFSET.x,
          y: block.position.y + DEFAULT_DUPLICATE_OFFSET.y,
        }

        const newName = getUniqueBlockName(block.name, get().blocks)

        const mergedBlock = mergeSubblockState(get().blocks, id)[id]

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
      },

      setBlockHandles: (id: string, horizontalHandles: boolean) => {
        const block = get().blocks[id]
        if (!block || block.horizontalHandles === horizontalHandles) return

        const newState = {
          blocks: {
            ...get().blocks,
            [id]: {
              ...block,
              horizontalHandles,
            },
          },
          edges: [...get().edges],
          loops: { ...get().loops },
        }

        set(newState)
        get().updateLastSaved()
      },

      updateBlockName: (id: string, name: string) => {
        const oldBlock = get().blocks[id]
        if (!oldBlock) return { success: false, changedSubblocks: [] }

        const normalizedNewName = normalizeName(name)

        if (!normalizedNewName) {
          logger.error(`Cannot rename block to empty name`)
          return { success: false, changedSubblocks: [] }
        }

        const currentBlocks = get().blocks
        const conflictingBlock = Object.entries(currentBlocks).find(
          ([blockId, block]) => blockId !== id && normalizeName(block.name) === normalizedNewName
        )

        if (conflictingBlock) {
          logger.error(
            `Cannot rename block to "${name}" - conflicts with "${conflictingBlock[1].name}"`
          )
          return { success: false, changedSubblocks: [] }
        }

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
        const changedSubblocks: Array<{ blockId: string; subBlockId: string; newValue: any }> = []

        if (activeWorkflowId) {
          // Get the workflow values for the active workflow
          // workflowValues: {[block_id]:{[subblock_id]:[subblock_value]}}
          const workflowValues = subBlockStore.workflowValues[activeWorkflowId] || {}
          const updatedWorkflowValues = { ...workflowValues }

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

          const oldBlockName = normalizeName(oldBlock.name)
          const newBlockName = normalizeName(name)
          const regex = new RegExp(`<${oldBlockName}\\.`, 'g')

          // Loop through blocks
          Object.entries(workflowValues).forEach(([blockId, blockValues]) => {
            if (blockId === id) return // Skip the block being renamed

            let blockHasChanges = false
            const updatedBlockValues = { ...blockValues }

            // Loop through subblocks and update references
            Object.entries(blockValues).forEach(([subBlockId, value]) => {
              // Use a recursive function to handle all object types
              const updatedValue = updateReferences(value, regex, `<${newBlockName}.`)

              // Check if the value actually changed
              if (JSON.stringify(updatedValue) !== JSON.stringify(value)) {
                updatedBlockValues[subBlockId] = updatedValue
                blockHasChanges = true
                changedSubblocks.push({
                  blockId,
                  subBlockId,
                  newValue: updatedValue,
                })
              }
            })

            if (blockHasChanges) {
              updatedWorkflowValues[blockId] = updatedBlockValues
            }
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
        get().updateLastSaved()
        // Note: Socket.IO handles real-time sync automatically

        // Return both success status and changed subblocks for collaborative sync
        return {
          success: true,
          changedSubblocks,
        }
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
                count: Math.max(1, Math.min(1000, count)), // Clamp between 1-1000
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
