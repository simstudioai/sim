import { BLOCK_DIMENSIONS, CONTAINER_DIMENSIONS } from '@sim/workflow-renderer'
import { estimateBlockDimensions } from '@/app/workspace/[workspaceId]/w/[workflowId]/utils'
import type { BlockState } from '@/stores/workflows/workflow/types'

/**
 * The size a block is drawn at on the read-only canvas: stored values when
 * present, clamped to the minimums, else the type's estimate. Shared with the
 * comparison overlay so its ghost collision boxes match what is drawn.
 */
export function getPreviewBlockDimensions(block: BlockState): { width: number; height: number } {
  if (block.type === 'loop' || block.type === 'parallel') {
    return {
      width: block.data?.width
        ? Math.max(block.data.width, CONTAINER_DIMENSIONS.MIN_WIDTH)
        : CONTAINER_DIMENSIONS.DEFAULT_WIDTH,
      height: block.data?.height
        ? Math.max(block.data.height, CONTAINER_DIMENSIONS.MIN_HEIGHT)
        : CONTAINER_DIMENSIONS.DEFAULT_HEIGHT,
    }
  }

  if (block.height) {
    return {
      width: BLOCK_DIMENSIONS.FIXED_WIDTH,
      height: Math.max(block.height, BLOCK_DIMENSIONS.MIN_HEIGHT),
    }
  }

  return estimateBlockDimensions(block.type)
}
