import { createLogger } from '@/lib/logs/console/logger'
import type { BlockState } from '@/stores/workflows/workflow/types'
import { assignLayers, groupByLayer } from './layering'
import { calculatePositions } from './positioning'
import type { Edge, LayoutOptions } from './types'
import {
  DEFAULT_CONTAINER_HEIGHT,
  DEFAULT_CONTAINER_WIDTH,
  getBlocksByParent,
  prepareBlockMetrics,
} from './utils'

const logger = createLogger('AutoLayout:Containers')

const CONTAINER_PADDING = 150
const CONTAINER_HORIZONTAL_PADDING = 180
const CONTAINER_VERTICAL_PADDING = 100

export function layoutContainers(
  blocks: Record<string, BlockState>,
  edges: Edge[],
  options: LayoutOptions = {}
): void {
  const { root, children } = getBlocksByParent(blocks)

  const containerOptions: LayoutOptions = {
    horizontalSpacing: options.horizontalSpacing ? options.horizontalSpacing * 0.85 : 400,
    verticalSpacing: options.verticalSpacing ? options.verticalSpacing : 200,
    padding: { x: CONTAINER_HORIZONTAL_PADDING, y: CONTAINER_VERTICAL_PADDING },
    alignment: options.alignment,
  }

  for (const [parentId, childIds] of children.entries()) {
    const parentBlock = blocks[parentId]
    if (!parentBlock) continue

    logger.debug('Processing container', { parentId, childCount: childIds.length })

    const childBlocks: Record<string, BlockState> = {}
    for (const childId of childIds) {
      childBlocks[childId] = blocks[childId]
    }

    const childEdges = edges.filter(
      (edge) => childIds.includes(edge.source) && childIds.includes(edge.target)
    )

    if (Object.keys(childBlocks).length === 0) {
      continue
    }

    const childNodes = assignLayers(childBlocks, childEdges)
    prepareBlockMetrics(childNodes)
    const childLayers = groupByLayer(childNodes)
    calculatePositions(childLayers, containerOptions)

    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY

    // Normalize positions to start from padding offset
    for (const node of childNodes.values()) {
      minX = Math.min(minX, node.position.x)
      minY = Math.min(minY, node.position.y)
      maxX = Math.max(maxX, node.position.x + node.metrics.width)
      maxY = Math.max(maxY, node.position.y + node.metrics.height)
    }

    // Adjust all child positions to start at proper padding from container edges
    const xOffset = CONTAINER_HORIZONTAL_PADDING - minX
    const yOffset = CONTAINER_VERTICAL_PADDING - minY

    for (const node of childNodes.values()) {
      childBlocks[node.id].position = {
        x: node.position.x + xOffset,
        y: node.position.y + yOffset,
      }
    }

    const calculatedWidth = maxX - minX + CONTAINER_PADDING * 2
    const calculatedHeight = maxY - minY + CONTAINER_PADDING * 2

    const containerWidth = Math.max(calculatedWidth, DEFAULT_CONTAINER_WIDTH)
    const containerHeight = Math.max(calculatedHeight, DEFAULT_CONTAINER_HEIGHT)

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
