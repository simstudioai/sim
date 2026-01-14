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

/** Default block dimensions for layout calculations */
const DEFAULT_BLOCK_WIDTH = 250
const DEFAULT_BLOCK_HEIGHT = 100

/**
 * Identifies groups from blocks and calculates their bounding boxes.
 * Returns a map of groupId to group info including bounding box and member block IDs.
 */
function identifyGroups(blocks: Record<string, BlockState>): Map<
  string,
  {
    blockIds: string[]
    bounds: { minX: number; minY: number; maxX: number; maxY: number }
  }
> {
  const groups = new Map<
    string,
    {
      blockIds: string[]
      bounds: { minX: number; minY: number; maxX: number; maxY: number }
    }
  >()

  // Group blocks by their groupId
  for (const [blockId, block] of Object.entries(blocks)) {
    const groupId = block.data?.groupId
    if (!groupId) continue

    if (!groups.has(groupId)) {
      groups.set(groupId, {
        blockIds: [],
        bounds: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
      })
    }

    const group = groups.get(groupId)!
    group.blockIds.push(blockId)

    // Update bounding box
    const blockWidth = block.data?.width ?? DEFAULT_BLOCK_WIDTH
    const blockHeight = block.data?.height ?? block.height ?? DEFAULT_BLOCK_HEIGHT

    group.bounds.minX = Math.min(group.bounds.minX, block.position.x)
    group.bounds.minY = Math.min(group.bounds.minY, block.position.y)
    group.bounds.maxX = Math.max(group.bounds.maxX, block.position.x + blockWidth)
    group.bounds.maxY = Math.max(group.bounds.maxY, block.position.y + blockHeight)
  }

  return groups
}

/**
 * Applies automatic layout to all blocks in a workflow.
 * Positions blocks in layers based on their connections (edges).
 * Groups are treated as single units and laid out together.
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

    // Identify groups and their bounding boxes
    const groups = identifyGroups(blocksCopy)

    logger.info('Identified block groups for layout', { groupCount: groups.size })

    // Pre-calculate container dimensions by laying out their children (bottom-up)
    // This ensures accurate widths/heights before root-level layout
    prepareContainerDimensions(
      blocksCopy,
      edges,
      layoutBlocksCore,
      horizontalSpacing,
      verticalSpacing
    )

    const { root: rootBlockIds } = getBlocksByParent(blocksCopy)
    const layoutRootIds = filterLayoutEligibleBlockIds(rootBlockIds, blocksCopy)

    // For groups, we need to:
    // 1. Create virtual blocks representing each group
    // 2. Replace grouped blocks with their group's virtual block
    // 3. Layout the virtual blocks + ungrouped blocks
    // 4. Apply position deltas to grouped blocks

    // Track which blocks are in groups at root level
    const groupedRootBlockIds = new Set<string>()
    const groupRepresentatives = new Map<string, string>() // groupId -> representative blockId

    // Store ORIGINAL positions of all grouped blocks before any modifications
    const originalBlockPositions = new Map<string, { x: number; y: number }>()
    for (const [_groupId, group] of groups) {
      for (const blockId of group.blockIds) {
        if (blocksCopy[blockId]) {
          originalBlockPositions.set(blockId, { ...blocksCopy[blockId].position })
        }
      }
    }

    for (const [groupId, group] of groups) {
      // Find if any blocks in this group are at root level
      const rootGroupBlocks = group.blockIds.filter((id) => layoutRootIds.includes(id))
      if (rootGroupBlocks.length > 0) {
        // Mark all blocks in this group as grouped
        for (const blockId of rootGroupBlocks) {
          groupedRootBlockIds.add(blockId)
        }
        // Use the first block as the group's representative for layout
        const representativeId = rootGroupBlocks[0]
        groupRepresentatives.set(groupId, representativeId)

        // Update the representative block's dimensions to match the group's bounding box
        const bounds = group.bounds
        const groupWidth = bounds.maxX - bounds.minX
        const groupHeight = bounds.maxY - bounds.minY

        blocksCopy[representativeId] = {
          ...blocksCopy[representativeId],
          data: {
            ...blocksCopy[representativeId].data,
            width: groupWidth,
            height: groupHeight,
          },
          // Position at the group's top-left corner
          position: { x: bounds.minX, y: bounds.minY },
        }
      }
    }

    // Build the blocks to layout: ungrouped blocks + group representatives
    const rootBlocks: Record<string, BlockState> = {}
    for (const id of layoutRootIds) {
      // Skip grouped blocks that aren't representatives
      if (groupedRootBlockIds.has(id)) {
        // Only include if this is a group representative
        for (const [groupId, repId] of groupRepresentatives) {
          if (repId === id) {
            rootBlocks[id] = blocksCopy[id]
            break
          }
        }
      } else {
        rootBlocks[id] = blocksCopy[id]
      }
    }

    // Remap edges: edges involving grouped blocks should connect to the representative
    const blockToGroup = new Map<string, string>() // blockId -> groupId
    for (const [groupId, group] of groups) {
      for (const blockId of group.blockIds) {
        blockToGroup.set(blockId, groupId)
      }
    }

    const layoutBlockIds = new Set(Object.keys(rootBlocks))
    const rootEdges = edges
      .map((edge) => {
        let source = edge.source
        let target = edge.target

        // Remap source if it's in a group
        const sourceGroupId = blockToGroup.get(source)
        if (sourceGroupId && groupRepresentatives.has(sourceGroupId)) {
          source = groupRepresentatives.get(sourceGroupId)!
        }

        // Remap target if it's in a group
        const targetGroupId = blockToGroup.get(target)
        if (targetGroupId && groupRepresentatives.has(targetGroupId)) {
          target = groupRepresentatives.get(targetGroupId)!
        }

        return { ...edge, source, target }
      })
      .filter((edge) => layoutBlockIds.has(edge.source) && layoutBlockIds.has(edge.target))

    // Calculate subflow depths before laying out root blocks
    const subflowDepths = calculateSubflowDepths(blocksCopy, edges, assignLayers)

    // Store old positions for groups to calculate deltas
    const oldGroupPositions = new Map<string, { x: number; y: number }>()
    for (const [groupId, repId] of groupRepresentatives) {
      oldGroupPositions.set(groupId, { ...blocksCopy[repId].position })
    }

    if (Object.keys(rootBlocks).length > 0) {
      const { nodes } = layoutBlocksCore(rootBlocks, rootEdges, {
        isContainer: false,
        layoutOptions: options,
        subflowDepths,
      })

      // Apply positions to ungrouped blocks and group representatives
      for (const node of nodes.values()) {
        blocksCopy[node.id].position = node.position
      }

      // For each group, calculate the delta and apply to ALL blocks in the group
      for (const [groupId, repId] of groupRepresentatives) {
        const oldGroupTopLeft = oldGroupPositions.get(groupId)!
        const newGroupTopLeft = blocksCopy[repId].position
        const deltaX = newGroupTopLeft.x - oldGroupTopLeft.x
        const deltaY = newGroupTopLeft.y - oldGroupTopLeft.y

        const group = groups.get(groupId)!
        // Apply delta to ALL blocks in the group using their ORIGINAL positions
        for (const blockId of group.blockIds) {
          if (layoutRootIds.includes(blockId)) {
            const originalPos = originalBlockPositions.get(blockId)
            if (originalPos) {
              blocksCopy[blockId].position = {
                x: originalPos.x + deltaX,
                y: originalPos.y + deltaY,
              }
            }
          }
        }

        // Restore the representative's original dimensions
        const originalBlock = blocks[repId]
        if (originalBlock) {
          blocksCopy[repId].data = {
            ...blocksCopy[repId].data,
            width: originalBlock.data?.width,
            height: originalBlock.data?.height,
          }
        }
      }
    }

    layoutContainers(blocksCopy, edges, options)

    logger.info('Auto layout completed successfully', {
      blockCount: Object.keys(blocksCopy).length,
      groupCount: groups.size,
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
