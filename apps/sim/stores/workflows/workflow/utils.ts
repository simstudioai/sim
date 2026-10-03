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
