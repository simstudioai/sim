/**
 * Server-Safe Workflow Utilities
 *
 * This file contains workflow utility functions that can be safely imported
 * by server-side API routes without causing client/server boundary violations.
 *
 * Unlike the main utils.ts file, this does NOT import any client-side stores
 * or React hooks, making it safe for use in Next.js API routes.
 */

import type { BlockState, SubBlockState } from './workflow/types'

/**
 * Server-safe version of mergeSubblockState for API routes
 *
 * Merges workflow block states with provided subblock values while maintaining block structure.
 * This version takes explicit subblock values instead of reading from client stores.
 *
 * @param blocks - Block configurations from workflow state
 * @param subBlockValues - Object containing subblock values keyed by blockId -> subBlockId -> value
 * @param blockId - Optional specific block ID to merge (merges all if not provided)
 * @returns Merged block states with updated values
 */
export function mergeSubblockState(
  blocks: Record<string, BlockState>,
  subBlockValues: Record<string, Record<string, any>> = {},
  blockId?: string
): Record<string, BlockState> {
  const blocksToProcess = blockId ? { [blockId]: blocks[blockId] } : blocks

  return Object.entries(blocksToProcess).reduce(
    (acc, [id, block]) => {
      // Skip if block is undefined
      if (!block) {
        return acc
      }

      // Initialize subBlocks if not present
      const blockSubBlocks = block.subBlocks || {}

      // Get stored values for this block
      const blockValues = subBlockValues[id] || {}

      // Create a deep copy of the block's subBlocks to maintain structure
      const mergedSubBlocks = Object.entries(blockSubBlocks).reduce(
        (subAcc, [subBlockId, subBlock]) => {
          // Skip if subBlock is undefined
          if (!subBlock) {
            return subAcc
          }

          // Get the stored value for this subblock
          const storedValue = blockValues[subBlockId]

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

      // Add any values that exist in the provided values but aren't in the block structure
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
 * Server-safe async version of mergeSubblockState for API routes
 *
 * Asynchronously merges workflow block states with provided subblock values.
 * This version takes explicit subblock values instead of reading from client stores.
 *
 * @param blocks - Block configurations from workflow state
 * @param subBlockValues - Object containing subblock values keyed by blockId -> subBlockId -> value
 * @param blockId - Optional specific block ID to merge (merges all if not provided)
 * @returns Promise resolving to merged block states with updated values
 */
export async function mergeSubblockStateAsync(
  blocks: Record<string, BlockState>,
  subBlockValues: Record<string, Record<string, any>> = {},
  blockId?: string
): Promise<Record<string, BlockState>> {
  // Since we're not reading from client stores, we can just return the sync version
  // The async nature was only needed for the client-side store operations
  return mergeSubblockState(blocks, subBlockValues, blockId)
}
