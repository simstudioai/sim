import { createLogger } from '@/lib/logs/console/logger'
import type { BlockState } from '@/stores/workflows/workflow/types'
import { layoutContainers } from './containers'
import { adjustForNewBlock as adjustForNewBlockInternal, compactHorizontally } from './incremental'
import { assignLayers, groupByLayer } from './layering'
import { calculatePositions } from './positioning'
import type { AdjustmentOptions, Edge, LayoutOptions, LayoutResult, Loop, Parallel } from './types'
import { filterLayoutEligibleBlockIds, getBlocksByParent, prepareBlockMetrics } from './utils'

const logger = createLogger('AutoLayout')

export function applyAutoLayout(
  blocks: Record<string, BlockState>,
  edges: Edge[],
  loops: Record<string, Loop> = {},
  parallels: Record<string, Parallel> = {},
  options: LayoutOptions = {}
): LayoutResult {
  try {
    logger.info('Starting auto layout', {
      blockCount: Object.keys(blocks).length,
      edgeCount: edges.length,
      loopCount: Object.keys(loops).length,
      parallelCount: Object.keys(parallels).length,
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
      const nodes = assignLayers(rootBlocks, rootEdges)
      prepareBlockMetrics(nodes)
      const layers = groupByLayer(nodes)
      calculatePositions(layers, options)

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

export function adjustForNewBlock(
  blocks: Record<string, BlockState>,
  edges: Edge[],
  newBlockId: string,
  options: AdjustmentOptions = {}
): LayoutResult {
  try {
    logger.info('Adjusting layout for new block', { newBlockId })

    const blocksCopy: Record<string, BlockState> = JSON.parse(JSON.stringify(blocks))

    adjustForNewBlockInternal(blocksCopy, edges, newBlockId, options)

    if (!options.preservePositions) {
      compactHorizontally(blocksCopy, edges)
    }

    return {
      blocks: blocksCopy,
      success: true,
    }
  } catch (error) {
    logger.error('Failed to adjust layout for new block', { newBlockId, error })
    return {
      blocks,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

export type { LayoutOptions, LayoutResult, AdjustmentOptions, Edge, Loop, Parallel }
export type { TargetedLayoutOptions } from './targeted'
export { applyTargetedLayout, transferBlockHeights } from './targeted'
export { getBlockMetrics, isContainerType, shouldSkipAutoLayout } from './utils'
