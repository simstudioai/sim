import { BLOCK_DIMENSIONS, CONTAINER_DIMENSIONS } from '@sim/workflow-renderer'
import { estimateBlockDimensions } from '@/app/workspace/[workspaceId]/w/[workflowId]/utils'
import type { BlockState } from '@/stores/workflows/workflow/types'

/**
 * Shared preview and overlay dimensions. Containers enclose their children,
 * including nested containers and removed blocks, without changing stored layout.
 */
export function getPreviewBlockDimensions(
  block: BlockState,
  blocks?: Record<string, BlockState>,
  ancestors: ReadonlySet<string> = new Set()
): { width: number; height: number } {
  if (block.type === 'loop' || block.type === 'parallel') {
    const visited = new Set(ancestors).add(block.id)
    let width: number = CONTAINER_DIMENSIONS.DEFAULT_WIDTH
    let height: number = CONTAINER_DIMENSIONS.DEFAULT_HEIGHT
    for (const child of Object.values(blocks ?? {})) {
      if (child.data?.parentId !== block.id || visited.has(child.id)) continue
      const dimensions = getPreviewBlockDimensions(child, blocks, visited)
      width = Math.max(
        width,
        child.position.x + dimensions.width + CONTAINER_DIMENSIONS.RIGHT_PADDING
      )
      height = Math.max(
        height,
        child.position.y + dimensions.height + CONTAINER_DIMENSIONS.BOTTOM_PADDING
      )
    }
    return { width, height }
  }

  if (block.height) {
    return {
      width: BLOCK_DIMENSIONS.FIXED_WIDTH,
      height: Math.max(block.height, BLOCK_DIMENSIONS.MIN_HEIGHT),
    }
  }

  return estimateBlockDimensions(block.type)
}
