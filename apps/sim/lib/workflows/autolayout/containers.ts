import { createLogger } from '@sim/logger'
import {
  CONTAINER_PADDING_X,
  CONTAINER_PADDING_Y,
  DEFAULT_VERTICAL_SPACING,
} from '@/lib/workflows/autolayout/constants'
import { layoutBlocksCore } from '@/lib/workflows/autolayout/core'
import type { Edge, LayoutOptions } from '@/lib/workflows/autolayout/types'
import { filterLayoutEligibleBlockIds, getBlocksByParent } from '@/lib/workflows/autolayout/utils'
import { CONTAINER_DIMENSIONS } from '@/lib/workflows/blocks/block-dimensions'
import type { BlockState } from '@/stores/workflows/workflow/types'

const logger = createLogger('AutoLayout:Containers')

/**
 * Default horizontal spacing for containers (tighter than root level)
 */
const DEFAULT_CONTAINER_HORIZONTAL_SPACING = 400

/**
 * Lays out children within container blocks (loops and parallels).
 * Updates both child positions and container dimensions.
 */
export function layoutContainers(
  blocks: Record<string, BlockState>,
  edges: Edge[],
  options: LayoutOptions = {}
): void {
  const { children } = getBlocksByParent(blocks)

  const containerOptions: LayoutOptions = {
    horizontalSpacing: options.horizontalSpacing
      ? options.horizontalSpacing * 0.85
      : DEFAULT_CONTAINER_HORIZONTAL_SPACING,
    verticalSpacing: options.verticalSpacing ?? DEFAULT_VERTICAL_SPACING,
    padding: { x: CONTAINER_PADDING_X, y: CONTAINER_PADDING_Y },
    gridSize: options.gridSize,
  }

  for (const [parentId, childIds] of children.entries()) {
    const parentBlock = blocks[parentId]
    if (!parentBlock) continue

    logger.debug('Processing container', { parentId, childCount: childIds.length })

    const layoutChildIds = filterLayoutEligibleBlockIds(childIds, blocks)
    const childBlocks: Record<string, BlockState> = {}
    for (const childId of layoutChildIds) {
      childBlocks[childId] = blocks[childId]
    }

    const childEdges = edges.filter(
      (edge) => layoutChildIds.includes(edge.source) && layoutChildIds.includes(edge.target)
    )

    if (Object.keys(childBlocks).length === 0) {
      continue
    }

    const { nodes, dimensions } = layoutBlocksCore(childBlocks, childEdges, {
      isContainer: true,
      layoutOptions: containerOptions,
    })

    for (const node of nodes.values()) {
      blocks[node.id].position = node.position
    }

    const calculatedWidth = dimensions.width
    const calculatedHeight = dimensions.height

    const containerWidth = Math.max(calculatedWidth, CONTAINER_DIMENSIONS.DEFAULT_WIDTH)
    const containerHeight = Math.max(calculatedHeight, CONTAINER_DIMENSIONS.DEFAULT_HEIGHT)

    if (!parentBlock.data) {
      parentBlock.data = {}
    }

    parentBlock.data.width = containerWidth
    parentBlock.data.height = containerHeight

    logger.debug('Container dimensions calculated', {
      parentId,
      width: containerWidth,
      height: containerHeight,
      childCount: childIds.length,
    })
  }
}
