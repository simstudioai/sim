import { BLOCK_DIMENSIONS, CONTAINER_DIMENSIONS } from '@sim/workflow-renderer'
import type { CanvasPort } from '@/lib/workflows/blocks/canvas-ports'
import { estimateBlockDimensions } from '@/app/workspace/[workspaceId]/w/[workflowId]/utils'
import {
  getPreviewPortContentHeight,
  getPreviewPortRows,
  PREVIEW_CARD_BORDER_WIDTH,
} from '@/app/workspace/[workspaceId]/w/components/preview/components/preview-workflow/preview-ports'
import type { BlockState } from '@/stores/workflows/workflow/types'

/**
 * Shared preview and overlay dimensions. Containers enclose their children,
 * including nested containers and removed blocks, without changing stored layout.
 */
export function getPreviewBlockDimensions(
  block: BlockState,
  blocks?: Record<string, BlockState>,
  removedPortsByBlock?: Record<string, CanvasPort[]>,
  ancestors: ReadonlySet<string> = new Set()
): { width: number; height: number } {
  const removedPorts = removedPortsByBlock?.[block.id] ?? []
  if (block.type === 'loop' || block.type === 'parallel') {
    const visited = new Set(ancestors).add(block.id)
    let width: number = CONTAINER_DIMENSIONS.DEFAULT_WIDTH
    let height: number = CONTAINER_DIMENSIONS.DEFAULT_HEIGHT
    for (const child of Object.values(blocks ?? {})) {
      if (child.data?.parentId !== block.id || visited.has(child.id)) continue
      const dimensions = getPreviewBlockDimensions(child, blocks, removedPortsByBlock, visited)
      width = Math.max(
        width,
        child.position.x + dimensions.width + CONTAINER_DIMENSIONS.RIGHT_PADDING
      )
      height = Math.max(
        height,
        child.position.y + dimensions.height + CONTAINER_DIMENSIONS.BOTTOM_PADDING
      )
    }
    return { width, height: height + getPreviewPortContentHeight(removedPorts.length) }
  }

  if (block.type === 'condition' || block.type === 'router_v2') {
    return {
      width: BLOCK_DIMENSIONS.FIXED_WIDTH,
      height:
        PREVIEW_CARD_BORDER_WIDTH * 2 +
        BLOCK_DIMENSIONS.HEADER_HEIGHT +
        getPreviewPortContentHeight(getPreviewPortRows(block, removedPorts).length),
    }
  }

  if (block.height) {
    return {
      width: BLOCK_DIMENSIONS.FIXED_WIDTH,
      height:
        Math.max(block.height, BLOCK_DIMENSIONS.MIN_HEIGHT) +
        getPreviewPortContentHeight(removedPorts.length),
    }
  }

  const dimensions = estimateBlockDimensions(block.type)
  return {
    ...dimensions,
    height: dimensions.height + getPreviewPortContentHeight(removedPorts.length),
  }
}
