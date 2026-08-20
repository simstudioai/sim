import { useSubBlockStore } from './subblock/store'
import type { BlockState, SubBlockState } from './workflow/types'

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

  // Get all the values stored in the subblock store for this workflow
  const workflowSubblockValues = workflowId ? subBlockStore.workflowValues[workflowId] || {} : {}

  return Object.entries(blocksToProcess).reduce(
    (acc, [id, block]) => {
      // Skip if block is undefined
      if (!block) {
        return acc
      }

      // Initialize subBlocks if not present
      const blockSubBlocks = block.subBlocks || {}

      // Get stored values for this block
      const blockValues = workflowSubblockValues[id] || {}

      // Create a deep copy of the block's subBlocks to maintain structure
      const mergedSubBlocks = Object.entries(blockSubBlocks).reduce(
        (subAcc, [subBlockId, subBlock]) => {
          // Skip if subBlock is undefined
          if (!subBlock) {
            return subAcc
          }

          // Get the stored value for this subblock
          let storedValue = null

          // If workflowId is provided, use it to get the value
          if (workflowId) {
            // Try to get the value from the subblock store for this specific workflow
            if (blockValues[subBlockId] !== undefined) {
              storedValue = blockValues[subBlockId]
            }
          } else {
            // Fall back to the active workflow if no workflowId is provided
            storedValue = subBlockStore.getValue(id, subBlockId)
          }

          // Create a new subblock object with the same structure but updated value
          subAcc[subBlockId] = {
            ...subBlock,
            value: storedValue !== undefined && storedValue !== null ? storedValue : subBlock.value,
          }

          return subAcc
        },
        {} as Record<string, SubBlockState>
      )

      // Return the full block state with updated subBlocks
      acc[id] = {
        ...block,
        subBlocks: mergedSubBlocks,
      }

      // Add any values that exist in the store but aren't in the block structure
      // This handles cases where block config has been updated but values still exist
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

      // Update the block with the final merged subBlocks (including orphaned values)
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
            return [subBlockId, subBlock] as const
          }

          // Get the stored value for this subblock
          let storedValue = null

          // If workflowId is provided, use it to get the value
          if (workflowId) {
            // Try to get the value from the subblock store for this specific workflow
            const workflowValues = subBlockStore.workflowValues[workflowId]
            if (workflowValues?.[id]) {
              storedValue = workflowValues[id][subBlockId]
            }
          } else {
            // Fall back to the active workflow if no workflowId is provided
            storedValue = subBlockStore.getValue(id, subBlockId)
          }

          // Create a new subblock object with the same structure but updated value
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
      const mergedSubBlocks = Object.fromEntries(subBlockEntries) as Record<string, SubBlockState>

      // Return the full block state with updated subBlocks
      return [
        id,
        {
          ...block,
          subBlocks: mergedSubBlocks,
        },
      ] as const
    })
  )

  // Convert entries back to an object
  return Object.fromEntries(processedBlockEntries) as Record<string, BlockState>
}
