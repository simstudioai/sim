import type { Edge } from 'reactflow'
import { v4 as uuidv4 } from 'uuid'
import { DEFAULT_DUPLICATE_OFFSET } from '@/lib/workflows/autolayout/constants'
import { getBlockOutputs } from '@/lib/workflows/blocks/block-outputs'
import { mergeSubblockStateWithValues } from '@/lib/workflows/subblocks'
import { TriggerUtils } from '@/lib/workflows/triggers/triggers'
import { getBlock } from '@/blocks'
import { isAnnotationOnlyBlock, normalizeName } from '@/executor/constants'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import type {
  BlockState,
  Loop,
  Parallel,
  Position,
  SubBlockState,
  WorkflowState,
} from '@/stores/workflows/workflow/types'
import { TRIGGER_RUNTIME_SUBBLOCK_IDS } from '@/triggers/constants'

/** Threshold to detect viewport-based offsets vs small duplicate offsets */
const LARGE_OFFSET_THRESHOLD = 300

/**
 * Checks if an edge is valid (source and target exist, not annotation-only, target is not a trigger)
 */
function isValidEdge(
  edge: Edge,
  blocks: Record<string, { type: string; triggerMode?: boolean }>
): boolean {
  const sourceBlock = blocks[edge.source]
  const targetBlock = blocks[edge.target]
  if (!sourceBlock || !targetBlock) return false
  if (isAnnotationOnlyBlock(sourceBlock.type)) return false
  if (isAnnotationOnlyBlock(targetBlock.type)) return false
  if (TriggerUtils.isTriggerBlock(targetBlock)) return false
  return true
}

/**
 * Filters edges to only include valid ones (target exists and is not a trigger block)
 */
export function filterValidEdges(
  edges: Edge[],
  blocks: Record<string, { type: string; triggerMode?: boolean }>
): Edge[] {
  return edges.filter((edge) => isValidEdge(edge, blocks))
}

export function filterNewEdges(edgesToAdd: Edge[], currentEdges: Edge[]): Edge[] {
  return edgesToAdd.filter((edge) => {
    if (edge.source === edge.target) return false
    return !currentEdges.some(
      (e) =>
        e.source === edge.source &&
        e.sourceHandle === edge.sourceHandle &&
        e.target === edge.target &&
        e.targetHandle === edge.targetHandle
    )
  })
}

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

  if (normalizedBaseName === 'response') {
    return 'Response'
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

export interface PrepareBlockStateOptions {
  id: string
  type: string
  name: string
  position: Position
  data?: Record<string, unknown>
  parentId?: string
  extent?: 'parent'
  triggerMode?: boolean
}

/**
 * Prepares a BlockState object from block type and configuration.
 * Generates subBlocks and outputs from the block registry.
 */
export function prepareBlockState(options: PrepareBlockStateOptions): BlockState {
  const { id, type, name, position, data, parentId, extent, triggerMode = false } = options

  const blockConfig = getBlock(type)

  const blockData: Record<string, unknown> = { ...(data || {}) }
  if (parentId) blockData.parentId = parentId
  if (extent) blockData.extent = extent

  if (!blockConfig) {
    return {
      id,
      type,
      name,
      position,
      data: blockData,
      subBlocks: {},
      outputs: {},
      enabled: true,
      horizontalHandles: true,
      advancedMode: false,
      triggerMode,
      height: 0,
    }
  }

  const subBlocks: Record<string, SubBlockState> = {}

  if (blockConfig.subBlocks) {
    blockConfig.subBlocks.forEach((subBlock) => {
      let initialValue: unknown = null

      if (typeof subBlock.value === 'function') {
        try {
          initialValue = subBlock.value({})
        } catch {
          initialValue = null
        }
      } else if (subBlock.defaultValue !== undefined) {
        initialValue = subBlock.defaultValue
      } else if (subBlock.type === 'input-format' || subBlock.type === 'response-format') {
        initialValue = [
          {
            id: crypto.randomUUID(),
            name: '',
            type: 'string',
            value: '',
            collapsed: false,
          },
        ]
      } else if (subBlock.type === 'table') {
        initialValue = []
      }

      subBlocks[subBlock.id] = {
        id: subBlock.id,
        type: subBlock.type,
        value: initialValue as SubBlockState['value'],
      }
    })
  }

  const outputs = getBlockOutputs(type, subBlocks, triggerMode)

  return {
    id,
    type,
    name,
    position,
    data: blockData,
    subBlocks,
    outputs,
    enabled: true,
    horizontalHandles: true,
    advancedMode: false,
    triggerMode,
    height: 0,
    locked: false,
  }
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
  const subBlockStore = useSubBlockStore.getState()

  const workflowSubblockValues = workflowId ? subBlockStore.workflowValues[workflowId] || {} : {}

  if (workflowId) {
    return mergeSubblockStateWithValues(blocks, workflowSubblockValues, blockId)
  }

  const blocksToProcess = blockId ? { [blockId]: blocks[blockId] } : blocks

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
            value: (storedValue !== undefined && storedValue !== null
              ? storedValue
              : subBlock.value) as SubBlockState['value'],
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
            value: value as SubBlockState['value'],
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

function updateValueReferences(value: unknown, nameMap: Map<string, string>): unknown {
  if (typeof value === 'string') {
    let updatedValue = value
    nameMap.forEach((newName, oldName) => {
      const regex = new RegExp(`<${oldName}\\.`, 'g')
      updatedValue = updatedValue.replace(regex, `<${newName}.`)
    })
    return updatedValue
  }
  if (Array.isArray(value)) {
    return value.map((item) => updateValueReferences(item, nameMap))
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      result[key] = updateValueReferences(val, nameMap)
    }
    return result
  }
  return value
}

function updateBlockReferences(
  blocks: Record<string, BlockState>,
  nameMap: Map<string, string>,
  clearTriggerRuntimeValues = false
): void {
  Object.entries(blocks).forEach(([_, block]) => {
    if (block.subBlocks) {
      Object.entries(block.subBlocks).forEach(([subBlockId, subBlock]) => {
        if (clearTriggerRuntimeValues && TRIGGER_RUNTIME_SUBBLOCK_IDS.includes(subBlockId)) {
          block.subBlocks[subBlockId] = { ...subBlock, value: null }
          return
        }

        if (subBlock.value !== undefined && subBlock.value !== null) {
          const updatedValue = updateValueReferences(
            subBlock.value,
            nameMap
          ) as SubBlockState['value']
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
  const nameMap = new Map<string, string>()
  const newBlocks: Record<string, BlockState> = {}

  // First pass: generate new IDs
  Object.entries(workflowState.blocks).forEach(([oldId, block]) => {
    const newId = uuidv4()
    blockIdMap.set(oldId, newId)
    const oldNormalizedName = normalizeName(block.name)
    nameMap.set(oldNormalizedName, oldNormalizedName)
    newBlocks[newId] = { ...block, id: newId }
  })

  // Second pass: update parentId references
  Object.values(newBlocks).forEach((block) => {
    if (block.data?.parentId) {
      const newParentId = blockIdMap.get(block.data.parentId)
      if (newParentId) {
        block.data = { ...block.data, parentId: newParentId }
      } else {
        // Parent not in the workflow, clear the relationship
        block.data = { ...block.data, parentId: undefined, extent: undefined }
      }
    }
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

  updateBlockReferences(newBlocks, nameMap, clearTriggerRuntimeValues)

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
  const nameMap = new Map<string, string>()
  const newBlocks: Record<string, BlockState> = {}
  const newSubBlockValues: Record<string, Record<string, unknown>> = {}

  // Track all blocks for name uniqueness (existing + newly processed)
  const allBlocksForNaming = { ...existingBlockNames }

  // First pass: generate new IDs and names for all blocks
  Object.entries(blocks).forEach(([oldId, block]) => {
    const newId = uuidv4()
    blockIdMap.set(oldId, newId)

    const oldNormalizedName = normalizeName(block.name)
    const newName = uniqueNameFn(block.name, allBlocksForNaming)
    const newNormalizedName = normalizeName(newName)
    nameMap.set(oldNormalizedName, newNormalizedName)

    // Determine position offset based on parent relationship:
    // 1. Parent also being copied: keep exact relative position (parent itself will be offset)
    // 2. Parent exists in existing workflow: use provided offset, but cap large viewport-based
    //    offsets since they don't make sense for relative positions
    // 3. Top-level block (no parent): apply full paste offset
    const hasParentInPasteSet = block.data?.parentId && blocks[block.data.parentId]
    const hasParentInExistingWorkflow =
      block.data?.parentId && existingBlockNames[block.data.parentId]

    let newPosition: Position
    if (hasParentInPasteSet) {
      // Parent also being copied - keep exact relative position
      newPosition = { x: block.position.x, y: block.position.y }
    } else if (hasParentInExistingWorkflow) {
      // Block stays in existing subflow - use provided offset unless it's viewport-based (large)
      const isLargeOffset =
        Math.abs(positionOffset.x) > LARGE_OFFSET_THRESHOLD ||
        Math.abs(positionOffset.y) > LARGE_OFFSET_THRESHOLD
      const effectiveOffset = isLargeOffset ? DEFAULT_DUPLICATE_OFFSET : positionOffset
      newPosition = {
        x: block.position.x + effectiveOffset.x,
        y: block.position.y + effectiveOffset.y,
      }
    } else {
      // Top-level block - apply full paste offset
      newPosition = {
        x: block.position.x + positionOffset.x,
        y: block.position.y + positionOffset.y,
      }
    }

    // Placeholder block - we'll update parentId in second pass
    const newBlock: BlockState = {
      ...block,
      id: newId,
      name: newName,
      position: newPosition,
      // Temporarily keep data as-is, we'll fix parentId in second pass
      data: block.data ? { ...block.data } : block.data,
      // Duplicated blocks are always unlocked so users can edit them
      locked: false,
    }

    newBlocks[newId] = newBlock
    // Add to tracking so next block gets unique name
    allBlocksForNaming[newId] = newBlock

    if (subBlockValues[oldId]) {
      newSubBlockValues[newId] = JSON.parse(JSON.stringify(subBlockValues[oldId]))
    }
  })

  // Second pass: update parentId references for nested blocks
  // If a block's parent is also being pasted, map to new parentId
  // If parent exists in existing workflow, keep the original parentId (block stays in same subflow)
  // Otherwise clear the parentId
  Object.entries(newBlocks).forEach(([, block]) => {
    if (block.data?.parentId) {
      const oldParentId = block.data.parentId
      const newParentId = blockIdMap.get(oldParentId)

      if (newParentId) {
        // Parent is being pasted - map to new parent ID
        block.data = {
          ...block.data,
          parentId: newParentId,
          extent: 'parent',
        }
      } else if (existingBlockNames[oldParentId] && !existingBlockNames[oldParentId].locked) {
        // Parent exists in existing workflow and is not locked - keep original parentId
        block.data = {
          ...block.data,
          parentId: oldParentId,
          extent: 'parent',
        }
      } else {
        // Parent doesn't exist anywhere OR parent is locked - clear the relationship
        block.data = { ...block.data, parentId: undefined, extent: undefined }
      }
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

  updateBlockReferences(newBlocks, nameMap, false)

  Object.entries(newSubBlockValues).forEach(([_, blockValues]) => {
    Object.keys(blockValues).forEach((subBlockId) => {
      blockValues[subBlockId] = updateValueReferences(blockValues[subBlockId], nameMap)
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
