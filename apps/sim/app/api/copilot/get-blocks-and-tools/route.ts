import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { registry as blockRegistry } from '@/blocks/registry'

const logger = createLogger('GetAllBlocksAPI')

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { includeDetails = false, filterCategory } = body

    logger.info('Getting all blocks and tools', { includeDetails, filterCategory })

    // Create mapping of block_id -> [tool_ids]
    const blockToToolsMapping: Record<string, string[]> = {}

    // Process blocks - filter out hidden blocks and map to their tools
    Object.entries(blockRegistry)
      .filter(([blockType, blockConfig]) => {
        // Filter out hidden blocks
        if (blockConfig.hideFromToolbar) return false

        // Apply category filter if specified
        if (filterCategory && blockConfig.category !== filterCategory) return false

        return true
      })
      .forEach(([blockType, blockConfig]) => {
        // Get the tools for this block
        const blockTools = blockConfig.tools?.access || []
        blockToToolsMapping[blockType] = blockTools
      })

    // Add special blocks that aren't in the standard registry
    // Loop and parallel blocks are handled differently but should be available
    const specialBlocks = {
      loop: {
        tools: [], // Loop blocks don't use standard tools
        category: 'blocks',
        description: 'Control flow block for iterating over collections or repeating actions',
      },
      parallel: {
        tools: [], // Parallel blocks don't use standard tools
        category: 'blocks',
        description: 'Control flow block for executing multiple branches simultaneously',
      },
    }

    // Add special blocks if they pass the category filter
    Object.entries(specialBlocks).forEach(([blockType, blockInfo]) => {
      if (!filterCategory || blockInfo.category === filterCategory) {
        blockToToolsMapping[blockType] = blockInfo.tools
      }
    })

    const totalBlocks = Object.keys(blockRegistry).length + Object.keys(specialBlocks).length
    const includedBlocks = Object.keys(blockToToolsMapping).length
    const filteredBlocksCount = totalBlocks - includedBlocks

    // Log block to tools mapping for debugging
    const blockToolsInfo = Object.entries(blockToToolsMapping)
      .map(([blockType, tools]) => `${blockType}: [${tools.join(', ')}]`)
      .sort()

    logger.info(`Successfully mapped ${includedBlocks} blocks to their tools`, {
      totalBlocks,
      includedBlocks,
      filteredBlocks: filteredBlocksCount,
      filterCategory,
      blockToolsMapping: blockToolsInfo,
      outputMapping: blockToToolsMapping,
      specialBlocksAdded: Object.keys(specialBlocks).filter(
        (blockType) =>
          !filterCategory ||
          specialBlocks[blockType as keyof typeof specialBlocks].category === filterCategory
      ),
    })

    return NextResponse.json({
      success: true,
      data: blockToToolsMapping,
    })
  } catch (error) {
    logger.error('Get all blocks failed', error)
    return NextResponse.json(
      {
        success: false,
        error: `Failed to get blocks and tools: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
      { status: 500 }
    )
  }
}
