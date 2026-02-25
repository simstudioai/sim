import type { BlockState } from '@/stores/workflows/workflow/types'

/**
 * Result of filtering protected blocks from a deletion operation
 */
export interface FilterProtectedBlocksResult {
  /** Block IDs that can be deleted (not protected) */
  deletableIds: string[]
  /** Block IDs that are protected and cannot be deleted */
  protectedIds: string[]
  /** Whether all blocks are protected (deletion should be cancelled entirely) */
  allProtected: boolean
}

/**
 * Checks if a block is protected from editing/deletion.
 * A block is protected if it is locked or if its parent container is locked.
 *
 * @param blockId - The ID of the block to check
 * @param blocks - Record of all blocks in the workflow
 * @returns True if the block is protected
 */
export function isBlockProtected(blockId: string, blocks: Record<string, BlockState>): boolean {
  const block = blocks[blockId]
  if (!block) return false

  // Block is locked directly
  if (block.locked) return true

  // Block is inside a locked container
  const parentId = block.data?.parentId
  if (parentId && blocks[parentId]?.locked) return true

  return false
}

/**
 * Checks if an edge is protected from modification.
 * An edge is protected only if its target block is protected.
 * Outbound connections from locked blocks are allowed to be modified.
 *
 * @param edge - The edge to check (must have source and target)
 * @param blocks - Record of all blocks in the workflow
 * @returns True if the edge is protected (target is locked)
 */
export function isEdgeProtected(
  edge: { source: string; target: string },
  blocks: Record<string, BlockState>
): boolean {
  return isBlockProtected(edge.target, blocks)
}

/**
 * Filters out protected blocks from a list of block IDs for deletion.
 * Protected blocks are those that are locked or inside a locked container.
 *
 * @param blockIds - Array of block IDs to filter
 * @param blocks - Record of all blocks in the workflow
 * @returns Result containing deletable IDs, protected IDs, and whether all are protected
 */
export function filterProtectedBlocks(
  blockIds: string[],
  blocks: Record<string, BlockState>
): FilterProtectedBlocksResult {
  const protectedIds = blockIds.filter((id) => isBlockProtected(id, blocks))
  const deletableIds = blockIds.filter((id) => !protectedIds.includes(id))

  return {
    deletableIds,
    protectedIds,
    allProtected: protectedIds.length === blockIds.length && blockIds.length > 0,
  }
}

/**
 * Returns block IDs ordered so that `batchToggleLocked` will target the desired state.
 *
 * `batchToggleLocked` determines its target locked state from `!firstBlock.locked`.
 * When `targetLocked` is true (lock all), an unlocked block must come first.
 * When `targetLocked` is false (unlock all), a locked block must come first.
 *
 * Returns an empty array when there are no blocks or all blocks already match `targetLocked`.
 *
 * @param blocks - Record of all blocks in the workflow
 * @param targetLocked - The desired locked state for all blocks
 * @returns Sorted block IDs, or empty array if no toggle is needed
 */
export function getWorkflowLockToggleIds(
  blocks: Record<string, BlockState>,
  targetLocked: boolean
): string[] {
  const ids = Object.keys(blocks)
  if (ids.length === 0) return []

  // No-op if all blocks already match the desired state
  const allMatch = Object.values(blocks).every((b) => Boolean(b.locked) === targetLocked)
  if (allMatch) return []

  ids.sort((a, b) => {
    const aVal = blocks[a].locked ? 1 : 0
    const bVal = blocks[b].locked ? 1 : 0
    // To lock all (targetLocked=true): unlocked first (aVal - bVal)
    // To unlock all (targetLocked=false): locked first (bVal - aVal)
    return targetLocked ? aVal - bVal : bVal - aVal
  })

  return ids
}
