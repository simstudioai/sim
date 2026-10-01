import {
  isWorkflowBlockAncestorLocked,
  isWorkflowBlockProtected,
} from '@sim/workflow-types/workflow'
import type { BlockState } from '@/stores/workflows/workflow/types'

/**
 * Find all descendant nodes, including children, grandchildren, etc.
 *
 * @param containerId - ID of the container to find descendants for
 * @param blocks - Record of all blocks in the workflow
 * @returns Array of node IDs that are descendants of this container
 */
export function findAllDescendantNodes(
  containerId: string,
  blocks: Record<string, BlockState>
): string[] {
  const descendants: string[] = []
  const visited = new Set<string>()
  const stack = [containerId]
  while (stack.length > 0) {
    const current = stack.pop()!
    if (visited.has(current)) continue
    visited.add(current)
    for (const block of Object.values(blocks)) {
      if (block.data?.parentId === current) {
        descendants.push(block.id)
        stack.push(block.id)
      }
    }
  }
  return descendants
}

/**
 * Checks if any ancestor container of a block is locked.
 * Unlike {@link isBlockProtected}, this ignores the block's own locked state.
 *
 * @param blockId - The ID of the block to check
 * @param blocks - Record of all blocks in the workflow
 * @returns True if any ancestor is locked
 */
export function isAncestorProtected(blockId: string, blocks: Record<string, BlockState>): boolean {
  return isWorkflowBlockAncestorLocked(blockId, blocks)
}

/**
 * Checks if a block is protected from editing/deletion.
 * A block is protected if it is locked or if any ancestor container is locked.
 *
 * @param blockId - The ID of the block to check
 * @param blocks - Record of all blocks in the workflow
 * @returns True if the block is protected
 */
export function isBlockProtected(blockId: string, blocks: Record<string, BlockState>): boolean {
  return isWorkflowBlockProtected(blockId, blocks)
}
