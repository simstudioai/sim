import { createLogger } from '@/lib/logs/console/logger'
import { layoutContainers } from '@/lib/workflows/autolayout/containers'
import { assignLayers, layoutBlocksCore } from '@/lib/workflows/autolayout/core'
import type { Edge, LayoutOptions, LayoutResult } from '@/lib/workflows/autolayout/types'
import { filterLayoutEligibleBlockIds, getBlocksByParent } from '@/lib/workflows/autolayout/utils'
import type { BlockState } from '@/stores/workflows/workflow/types'

const logger = createLogger('AutoLayout')

/**
 * Calculates the internal depth (max layer count) for each subflow container.
 * This is used to properly position blocks that connect after a subflow ends.
 *
 * @param blocks - All blocks in the workflow
 * @param edges - All edges in the workflow
 * @returns Map of container block IDs to their internal layer depth
 */
function calculateSubflowDepths(
  blocks: Record<string, BlockState>,
  edges: Edge[]
): Map<string, number> {
  const depths = new Map<string, number>()
  const { children } = getBlocksByParent(blocks)

  for (const [containerId, childIds] of children.entries()) {
    if (childIds.length === 0) {
      // Empty subflows have depth of 1 (the subflow itself takes up a layer)
      depths.set(containerId, 1)
      continue
    }

    // Get child blocks for this container
    const childBlocks: Record<string, BlockState> = {}
    const layoutChildIds = filterLayoutEligibleBlockIds(childIds, blocks)
    for (const childId of layoutChildIds) {
      childBlocks[childId] = blocks[childId]
    }

    // Filter edges to only those within this container
    const childEdges = edges.filter(
      (edge) => layoutChildIds.includes(edge.source) && layoutChildIds.includes(edge.target)
    )

    if (Object.keys(childBlocks).length === 0) {
      depths.set(containerId, 1)
      continue
    }

    // Calculate layers for child blocks to find max depth
    const childNodes = assignLayers(childBlocks, childEdges)
    let maxLayer = 0
    for (const node of childNodes.values()) {
      maxLayer = Math.max(maxLayer, node.layer)
    }

    // Depth is maxLayer + 1 (since layers are 0-indexed)
    // Minimum depth of 1 to ensure subflows always "take up space"
    depths.set(containerId, Math.max(maxLayer + 1, 1))
  }

  return depths
}

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

    const { root: rootBlockIds } = getBlocksByParent(blocksCopy)
    const layoutRootIds = filterLayoutEligibleBlockIds(rootBlockIds, blocksCopy)

    const rootBlocks: Record<string, BlockState> = {}
    for (const id of layoutRootIds) {
      rootBlocks[id] = blocksCopy[id]
    }

    const rootEdges = edges.filter(
      (edge) => layoutRootIds.includes(edge.source) && layoutRootIds.includes(edge.target)
    )

    // Calculate subflow depths before laying out root blocks
    // This ensures blocks connected to subflow ends are positioned correctly
    const subflowDepths = calculateSubflowDepths(blocksCopy, edges)

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
// Function exports
export { applyTargetedLayout } from '@/lib/workflows/autolayout/targeted'
// Type exports
export type { Edge, LayoutOptions, LayoutResult } from '@/lib/workflows/autolayout/types'
export {
  getBlockMetrics,
  isContainerType,
  shouldSkipAutoLayout,
  transferBlockHeights,
} from '@/lib/workflows/autolayout/utils'
