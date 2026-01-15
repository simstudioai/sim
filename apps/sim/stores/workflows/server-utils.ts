/**
 * Server-Safe Workflow Utilities
 *
 * This file contains workflow utility functions that can be safely imported
 * by server-side API routes without causing client/server boundary violations.
 *
 * Unlike the main utils.ts file, this does NOT import any client-side stores
 * or React hooks, making it safe for use in Next.js API routes.
 */

import { mergeSubblockStateWithValues } from '@/lib/workflows/subblocks'
import type { BlockState } from '@/stores/workflows/workflow/types'

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
  return mergeSubblockStateWithValues(blocks, subBlockValues, blockId)
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
