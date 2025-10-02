import { createLogger } from '@/lib/logs/console/logger'
import type { GraphNode, LayoutOptions } from './types'
import { boxesOverlap, createBoundingBox } from './utils'

const logger = createLogger('AutoLayout:Positioning')

const DEFAULT_HORIZONTAL_SPACING = 550
const DEFAULT_VERTICAL_SPACING = 200
const DEFAULT_PADDING = { x: 150, y: 150 }

export function calculatePositions(
  layers: Map<number, GraphNode[]>,
  options: LayoutOptions = {}
): void {
  const horizontalSpacing = options.horizontalSpacing ?? DEFAULT_HORIZONTAL_SPACING
  const verticalSpacing = options.verticalSpacing ?? DEFAULT_VERTICAL_SPACING
  const padding = options.padding ?? DEFAULT_PADDING
  const alignment = options.alignment ?? 'center'

  const layerNumbers = Array.from(layers.keys()).sort((a, b) => a - b)

  // Calculate positions for each layer
  for (const layerNum of layerNumbers) {
    const nodesInLayer = layers.get(layerNum)!
    const xPosition = padding.x + layerNum * horizontalSpacing

    // Calculate total height needed for this layer
    const totalHeight = nodesInLayer.reduce(
      (sum, node, idx) => sum + node.metrics.height + (idx > 0 ? verticalSpacing : 0),
      0
    )

    // Start Y position based on alignment
    let yOffset: number
    switch (alignment) {
      case 'start':
        yOffset = padding.y
        break
      case 'center':
        // Center the layer vertically
        yOffset = Math.max(padding.y, 300 - totalHeight / 2)
        break
      case 'end':
        yOffset = 600 - totalHeight - padding.y
        break
      default:
        yOffset = padding.y
        break
    }

    // Position each node in the layer
    for (const node of nodesInLayer) {
      node.position = {
        x: xPosition,
        y: yOffset,
      }

      yOffset += node.metrics.height + verticalSpacing
    }
  }

  // Resolve any overlaps
  resolveOverlaps(Array.from(layers.values()).flat(), verticalSpacing)
}

function resolveOverlaps(nodes: GraphNode[], verticalSpacing: number): void {
  const MAX_ITERATIONS = 20
  let iteration = 0
  let hasOverlap = true

  while (hasOverlap && iteration < MAX_ITERATIONS) {
    hasOverlap = false
    iteration++

    // Sort nodes by position for consistent processing
    const sortedNodes = [...nodes].sort((a, b) => {
      if (a.layer !== b.layer) return a.layer - b.layer
      return a.position.y - b.position.y
    })

    for (let i = 0; i < sortedNodes.length; i++) {
      for (let j = i + 1; j < sortedNodes.length; j++) {
        const node1 = sortedNodes[i]
        const node2 = sortedNodes[j]

        const box1 = createBoundingBox(node1.position, node1.metrics)
        const box2 = createBoundingBox(node2.position, node2.metrics)

        // Check for overlap with margin
        if (boxesOverlap(box1, box2, 30)) {
          hasOverlap = true

          // If in same layer, shift vertically
          if (node1.layer === node2.layer) {
            const totalHeight = node1.metrics.height + node2.metrics.height + verticalSpacing
            const midpoint = (node1.position.y + node2.position.y) / 2

            node1.position.y = midpoint - node1.metrics.height / 2 - verticalSpacing / 2
            node2.position.y = midpoint + node2.metrics.height / 2 + verticalSpacing / 2
          } else {
            // Different layers - shift the later one down
            const requiredSpace = box1.y + box1.height + verticalSpacing
            if (node2.position.y < requiredSpace) {
              node2.position.y = requiredSpace
            }
          }

          logger.debug('Resolved overlap between blocks', {
            block1: node1.id,
            block2: node2.id,
            samLayer: node1.layer === node2.layer,
            iteration,
          })
        }
      }
    }
  }

  if (hasOverlap) {
    logger.warn('Could not fully resolve all overlaps after max iterations', {
      iterations: MAX_ITERATIONS,
    })
  }
}
