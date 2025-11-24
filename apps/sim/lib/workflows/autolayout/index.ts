import { createLogger } from '@/lib/logs/console/logger'
import type { BlockState } from '@/stores/workflows/workflow/types'
import { layoutContainers } from './containers'
import { layoutBlocksCore } from './core'
import type { Edge, LayoutOptions, LayoutResult } from './types'
import { filterLayoutEligibleBlockIds, getBlocksByParent } from './utils'

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

    const { root: rootBlockIds } = getBlocksByParent(blocksCopy)
    const layoutRootIds = filterLayoutEligibleBlockIds(rootBlockIds, blocksCopy)

    const rootBlocks: Record<string, BlockState> = {}
    for (const id of layoutRootIds) {
      rootBlocks[id] = blocksCopy[id]
    }

    const rootEdges = edges.filter(
      (edge) => layoutRootIds.includes(edge.source) && layoutRootIds.includes(edge.target)
    )

    if (Object.keys(rootBlocks).length > 0) {
      const { nodes } = layoutBlocksCore(rootBlocks, rootEdges, {
        isContainer: false,
        layoutOptions: options,
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

export type { TargetedLayoutOptions } from './targeted'
// Function exports
export { applyTargetedLayout } from './targeted'
// Type exports
export type { Edge, LayoutOptions, LayoutResult } from './types'
export {
  getBlockMetrics,
  isContainerType,
  shouldSkipAutoLayout,
  transferBlockHeights,
} from './utils'
