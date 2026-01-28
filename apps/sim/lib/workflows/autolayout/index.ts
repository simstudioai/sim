import { createLogger } from '@sim/logger'
import {
  DEFAULT_HORIZONTAL_SPACING,
  DEFAULT_VERTICAL_SPACING,
} from '@/lib/workflows/autolayout/constants'
import { layoutContainers } from '@/lib/workflows/autolayout/containers'
import { assignLayers, layoutBlocksCore } from '@/lib/workflows/autolayout/core'
import type { Edge, LayoutOptions, LayoutResult } from '@/lib/workflows/autolayout/types'
import {
  calculateSubflowDepths,
  filterLayoutEligibleBlockIds,
  getBlocksByParent,
  prepareContainerDimensions,
} from '@/lib/workflows/autolayout/utils'
import type { BlockState } from '@/stores/workflows/workflow/types'

const logger = createLogger('AutoLayout')

/**
 * Applies automatic layout to all blocks in a workflow.
 * Positions blocks in layers based on their connections (edges).
 */
export function applyAutoLayout(
  blocks: Record<string, BlockState>,
  edges: Edge[],
  options: LayoutOptions = {}
): LayoutResult {
  try {
    logger.info('Starting auto layout', {
      blockCount: Object.keys(blocks).length,
      edgeCount: edges.length,
    })

    const blocksCopy: Record<string, BlockState> = JSON.parse(JSON.stringify(blocks))

    const horizontalSpacing = options.horizontalSpacing ?? DEFAULT_HORIZONTAL_SPACING
    const verticalSpacing = options.verticalSpacing ?? DEFAULT_VERTICAL_SPACING

    prepareContainerDimensions(
      blocksCopy,
      edges,
      layoutBlocksCore,
      horizontalSpacing,
      verticalSpacing,
      options.gridSize
    )

    const { root: rootBlockIds } = getBlocksByParent(blocksCopy)
    const layoutRootIds = filterLayoutEligibleBlockIds(rootBlockIds, blocksCopy)

    const rootBlocks: Record<string, BlockState> = {}
    for (const id of layoutRootIds) {
      rootBlocks[id] = blocksCopy[id]
    }

    const rootEdges = edges.filter(
      (edge) => layoutRootIds.includes(edge.source) && layoutRootIds.includes(edge.target)
    )

    const subflowDepths = calculateSubflowDepths(blocksCopy, edges, assignLayers)

    if (Object.keys(rootBlocks).length > 0) {
      const { nodes } = layoutBlocksCore(rootBlocks, rootEdges, {
        isContainer: false,
        layoutOptions: options,
        subflowDepths,
      })

      for (const node of nodes.values()) {
        blocksCopy[node.id].position = node.position
      }
    }

    layoutContainers(blocksCopy, edges, options)

    logger.info('Auto layout completed successfully', {
      blockCount: Object.keys(blocksCopy).length,
    })

    return {
      blocks: blocksCopy,
      success: true,
    }
  } catch (error) {
    logger.error('Auto layout failed', { error })
    return {
      blocks,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

export type { TargetedLayoutOptions } from '@/lib/workflows/autolayout/targeted'
export { applyTargetedLayout } from '@/lib/workflows/autolayout/targeted'
export type { Edge, LayoutOptions, LayoutResult } from '@/lib/workflows/autolayout/types'
export {
  getBlockMetrics,
  isContainerType,
  shouldSkipAutoLayout,
  snapPositionToGrid,
  transferBlockHeights,
} from '@/lib/workflows/autolayout/utils'
