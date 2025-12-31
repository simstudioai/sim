import type { Edge } from 'reactflow'
import { v4 as uuidv4 } from 'uuid'
import { normalizeName } from '@/executor/constants'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import type {
  BlockState,
  Loop,
  Parallel,
  SubBlockState,
  WorkflowState,
} from '@/stores/workflows/workflow/types'
import { TRIGGER_RUNTIME_SUBBLOCK_IDS } from '@/triggers/constants'

export { normalizeName }

export interface RegeneratedState {
  blocks: Record<string, BlockState>
  edges: Edge[]
  loops: Record<string, Loop>
  parallels: Record<string, Parallel>
  idMap: Map<string, string>
}

/**
 * Generates a unique block name by finding the highest number suffix among existing blocks
 * with the same base name and incrementing it
 * @param baseName - The base name for the block (e.g., "API 1", "Agent", "Loop 3")
 * @param existingBlocks - Record of existing blocks to check against
 * @returns A unique block name with an appropriate number suffix
 */
export function getUniqueBlockName(baseName: string, existingBlocks: Record<string, any>): string {
  // Special case: Start blocks should always be named "Start" without numbers
  // This applies to both "Start" and "Starter" base names
  const normalizedBaseName = normalizeName(baseName)
  if (normalizedBaseName === 'start' || normalizedBaseName === 'starter') {
    return 'Start'
  }

  const baseNameMatch = baseName.match(/^(.*?)(\s+\d+)?$/)
  const namePrefix = baseNameMatch ? baseNameMatch[1].trim() : baseName

  const normalizedBase = normalizeName(namePrefix)

  const existingNumbers = Object.values(existingBlocks)
    .filter((block) => {
      const blockNameMatch = block.name?.match(/^(.*?)(\s+\d+)?$/)
      const blockPrefix = blockNameMatch ? blockNameMatch[1].trim() : block.name
      return blockPrefix && normalizeName(blockPrefix) === normalizedBase
    })
    .map((block) => {
      const match = block.name?.match(/(\d+)$/)
      return match ? Number.parseInt(match[1], 10) : 0
    })

  const maxNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) : 0

  if (maxNumber === 0 && existingNumbers.length === 0) {
    return `${namePrefix} 1`
  }

  return `${namePrefix} ${maxNumber + 1}`
}

/**
 * Merges workflow block states with subblock values while maintaining block structure
 * @param blocks - Block configurations from workflow store
 * @param workflowId - ID of the workflow to merge values for
 * @param blockId - Optional specific block ID to merge (merges all if not provided)
 * @returns Merged block states with updated values
 */
export function mergeSubblockState(
  blocks: Record<string, BlockState>,
  workflowId?: string,
  blockId?: string
): Record<string, BlockState> {
  const blocksToProcess = blockId ? { [blockId]: blocks[blockId] } : blocks
  const subBlockStore = useSubBlockStore.getState()

  const workflowSubblockValues = workflowId ? subBlockStore.workflowValues[workflowId] || {} : {}

  return Object.entries(blocksToProcess).reduce(
    (acc, [id, block]) => {
      if (!block) {
        return acc
      }

      const blockSubBlocks = block.subBlocks || {}

      const blockValues = workflowSubblockValues[id] || {}

      const mergedSubBlocks = Object.entries(blockSubBlocks).reduce(
        (subAcc, [subBlockId, subBlock]) => {
          if (!subBlock) {
            return subAcc
          }

          let storedValue = null

          if (workflowId) {
            if (blockValues[subBlockId] !== undefined) {
              storedValue = blockValues[subBlockId]
            }
          } else {
            storedValue = subBlockStore.getValue(id, subBlockId)
          }

          subAcc[subBlockId] = {
            ...subBlock,
            value: storedValue !== undefined && storedValue !== null ? storedValue : subBlock.value,
          }

          return subAcc
        },
        {} as Record<string, SubBlockState>
      )

      // Add any values that exist in the store but aren't in the block structure
      // This handles cases where block config has been updated but values still exist
      // IMPORTANT: This includes runtime subblock IDs like webhookId, triggerPath, etc.
      Object.entries(blockValues).forEach(([subBlockId, value]) => {
        if (!mergedSubBlocks[subBlockId] && value !== null && value !== undefined) {
          // Create a minimal subblock structure
          mergedSubBlocks[subBlockId] = {
            id: subBlockId,
            type: 'short-input', // Default type that's safe to use
            value: value,
          }
        }
      })

      // Return the full block state with updated subBlocks (including orphaned values)
      acc[id] = {
        ...block,
        subBlocks: mergedSubBlocks,
      }

      return acc
    },
    {} as Record<string, BlockState>
  )
}

/**
 * Asynchronously merges workflow block states with subblock values
 * Ensures all values are properly resolved before returning
 *
 * @param blocks - Block configurations from workflow store
 * @param workflowId - ID of the workflow to merge values for
 * @param blockId - Optional specific block ID to merge (merges all if not provided)
 * @returns Promise resolving to merged block states with updated values
 */
export async function mergeSubblockStateAsync(
  blocks: Record<string, BlockState>,
  workflowId?: string,
  blockId?: string
): Promise<Record<string, BlockState>> {
  const blocksToProcess = blockId ? { [blockId]: blocks[blockId] } : blocks
  const subBlockStore = useSubBlockStore.getState()

  // Process blocks in parallel for better performance
  const processedBlockEntries = await Promise.all(
    Object.entries(blocksToProcess).map(async ([id, block]) => {
      // Skip if block is undefined or doesn't have subBlocks
      if (!block || !block.subBlocks) {
        return [id, block] as const
      }

      // Process all subblocks in parallel
      const subBlockEntries = await Promise.all(
        Object.entries(block.subBlocks).map(async ([subBlockId, subBlock]) => {
          // Skip if subBlock is undefined
          if (!subBlock) {
            return null
          }

          let storedValue = null

          if (workflowId) {
            const workflowValues = subBlockStore.workflowValues[workflowId]
            if (workflowValues?.[id]) {
              storedValue = workflowValues[id][subBlockId]
            }
          } else {
            storedValue = subBlockStore.getValue(id, subBlockId)
          }

          return [
            subBlockId,
            {
              ...subBlock,
              value:
                storedValue !== undefined && storedValue !== null ? storedValue : subBlock.value,
            },
          ] as const
        })
      )

      // Convert entries back to an object
      const mergedSubBlocks = Object.fromEntries(
        subBlockEntries.filter((entry): entry is readonly [string, SubBlockState] => entry !== null)
      ) as Record<string, SubBlockState>

      // Add any values that exist in the store but aren't in the block structure
      // This handles cases where block config has been updated but values still exist
      // IMPORTANT: This includes runtime subblock IDs like webhookId, triggerPath, etc.
      if (workflowId) {
        const workflowValues = subBlockStore.workflowValues[workflowId]
        const blockValues = workflowValues?.[id] || {}
        Object.entries(blockValues).forEach(([subBlockId, value]) => {
          if (!mergedSubBlocks[subBlockId] && value !== null && value !== undefined) {
            mergedSubBlocks[subBlockId] = {
              id: subBlockId,
              type: 'short-input',
              value: value,
            }
          }
        })
      }

      // Return the full block state with updated subBlocks (including orphaned values)
      return [
        id,
        {
          ...block,
          subBlocks: mergedSubBlocks,
        },
      ] as const
    })
  )

  return Object.fromEntries(processedBlockEntries) as Record<string, BlockState>
}

function updateBlockReferences(
  blocks: Record<string, BlockState>,
  idMap: Map<string, string>,
  clearTriggerRuntimeValues = false
): void {
  Object.entries(blocks).forEach(([_, block]) => {
    if (block.data?.parentId) {
      const newParentId = idMap.get(block.data.parentId)
      if (newParentId) {
        block.data = { ...block.data, parentId: newParentId }
      } else {
        block.data = { ...block.data, parentId: undefined, extent: undefined }
      }
    }

    if (block.subBlocks) {
      Object.entries(block.subBlocks).forEach(([subBlockId, subBlock]) => {
        if (clearTriggerRuntimeValues && TRIGGER_RUNTIME_SUBBLOCK_IDS.includes(subBlockId)) {
          block.subBlocks[subBlockId] = { ...subBlock, value: null }
          return
        }

        if (subBlock.value && typeof subBlock.value === 'string') {
          let updatedValue = subBlock.value
          idMap.forEach((newId, oldId) => {
            const regex = new RegExp(`<${oldId}\\.`, 'g')
            updatedValue = updatedValue.replace(regex, `<${newId}.`)
          })
          block.subBlocks[subBlockId] = { ...subBlock, value: updatedValue }
        }
      })
    }
  })
}

export function regenerateWorkflowIds(
  workflowState: WorkflowState,
  options: { clearTriggerRuntimeValues?: boolean } = {}
): WorkflowState & { idMap: Map<string, string> } {
  const { clearTriggerRuntimeValues = true } = options
  const blockIdMap = new Map<string, string>()
  const newBlocks: Record<string, BlockState> = {}

  Object.entries(workflowState.blocks).forEach(([oldId, block]) => {
    const newId = uuidv4()
    blockIdMap.set(oldId, newId)
    newBlocks[newId] = { ...block, id: newId }
  })

  const newEdges = workflowState.edges.map((edge) => ({
    ...edge,
    id: uuidv4(),
    source: blockIdMap.get(edge.source) || edge.source,
    target: blockIdMap.get(edge.target) || edge.target,
  }))

  const newLoops: Record<string, Loop> = {}
  if (workflowState.loops) {
    Object.entries(workflowState.loops).forEach(([oldLoopId, loop]) => {
      const newLoopId = blockIdMap.get(oldLoopId) || oldLoopId
      newLoops[newLoopId] = {
        ...loop,
        id: newLoopId,
        nodes: loop.nodes.map((nodeId) => blockIdMap.get(nodeId) || nodeId),
      }
    })
  }

  const newParallels: Record<string, Parallel> = {}
  if (workflowState.parallels) {
    Object.entries(workflowState.parallels).forEach(([oldParallelId, parallel]) => {
      const newParallelId = blockIdMap.get(oldParallelId) || oldParallelId
      newParallels[newParallelId] = {
        ...parallel,
        id: newParallelId,
        nodes: parallel.nodes.map((nodeId) => blockIdMap.get(nodeId) || nodeId),
      }
    })
  }

  updateBlockReferences(newBlocks, blockIdMap, clearTriggerRuntimeValues)

  return {
    blocks: newBlocks,
    edges: newEdges,
    loops: newLoops,
    parallels: newParallels,
    metadata: workflowState.metadata,
    variables: workflowState.variables,
    idMap: blockIdMap,
  }
}

export function regenerateBlockIds(
  blocks: Record<string, BlockState>,
  edges: Edge[],
  loops: Record<string, Loop>,
  parallels: Record<string, Parallel>,
  subBlockValues: Record<string, Record<string, unknown>>,
  positionOffset: { x: number; y: number },
  existingBlockNames: Record<string, BlockState>,
  uniqueNameFn: (name: string, blocks: Record<string, BlockState>) => string
): RegeneratedState & { subBlockValues: Record<string, Record<string, unknown>> } {
  const blockIdMap = new Map<string, string>()
  const newBlocks: Record<string, BlockState> = {}
  const newSubBlockValues: Record<string, Record<string, unknown>> = {}

  Object.entries(blocks).forEach(([oldId, block]) => {
    const newId = uuidv4()
    blockIdMap.set(oldId, newId)

    newBlocks[newId] = {
      ...block,
      id: newId,
      name: uniqueNameFn(block.name, existingBlockNames),
      position: {
        x: block.position.x + positionOffset.x,
        y: block.position.y + positionOffset.y,
      },
    }

    if (subBlockValues[oldId]) {
      newSubBlockValues[newId] = JSON.parse(JSON.stringify(subBlockValues[oldId]))
    }
  })

  const newEdges = edges.map((edge) => ({
    ...edge,
    id: uuidv4(),
    source: blockIdMap.get(edge.source) || edge.source,
    target: blockIdMap.get(edge.target) || edge.target,
  }))

  const newLoops: Record<string, Loop> = {}
  Object.entries(loops).forEach(([oldLoopId, loop]) => {
    const newLoopId = blockIdMap.get(oldLoopId) || oldLoopId
    newLoops[newLoopId] = {
      ...loop,
      id: newLoopId,
      nodes: loop.nodes.map((nodeId) => blockIdMap.get(nodeId) || nodeId),
    }
  })

  const newParallels: Record<string, Parallel> = {}
  Object.entries(parallels).forEach(([oldParallelId, parallel]) => {
    const newParallelId = blockIdMap.get(oldParallelId) || oldParallelId
    newParallels[newParallelId] = {
      ...parallel,
      id: newParallelId,
      nodes: parallel.nodes.map((nodeId) => blockIdMap.get(nodeId) || nodeId),
    }
  })

  updateBlockReferences(newBlocks, blockIdMap, false)

  Object.entries(newSubBlockValues).forEach(([_, blockValues]) => {
    Object.entries(blockValues).forEach(([subBlockId, value]) => {
      if (typeof value === 'string') {
        let updatedValue = value
        blockIdMap.forEach((newId, oldId) => {
          const regex = new RegExp(`<${oldId}\\.`, 'g')
          updatedValue = updatedValue.replace(regex, `<${newId}.`)
        })
        blockValues[subBlockId] = updatedValue
      }
    })
  })

  return {
    blocks: newBlocks,
    edges: newEdges,
    loops: newLoops,
    parallels: newParallels,
    subBlockValues: newSubBlockValues,
    idMap: blockIdMap,
  }
}
