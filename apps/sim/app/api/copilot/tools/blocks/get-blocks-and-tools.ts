import { createLogger } from '@/lib/logs/console-logger'
import { registry as blockRegistry } from '@/blocks/registry'
import { BaseCopilotTool } from '../base'

type GetBlocksAndToolsParams = {}

class GetBlocksAndToolsTool extends BaseCopilotTool<
  GetBlocksAndToolsParams,
  Record<string, string[]>
> {
  readonly id = 'get_blocks_and_tools'
  readonly displayName = 'Getting block information'

  protected async executeImpl(params: GetBlocksAndToolsParams): Promise<Record<string, string[]>> {
    return getBlocksAndTools()
  }
}

// Export the tool instance
export const getBlocksAndToolsTool = new GetBlocksAndToolsTool()

// Implementation function
async function getBlocksAndTools(): Promise<Record<string, string[]>> {
  const logger = createLogger('GetBlocksAndTools')

  logger.info('Getting all blocks and tools')

  // Create mapping of block_id -> [tool_ids]
  const blockToToolsMapping: Record<string, string[]> = {}

  // Process blocks - filter out hidden blocks and map to their tools
  Object.entries(blockRegistry)
    .filter(([blockType, blockConfig]) => {
      // Filter out hidden blocks
      if (blockConfig.hideFromToolbar) return false
      return true
    })
    .forEach(([blockType, blockConfig]) => {
      // Get the tools for this block
      const blockTools = blockConfig.tools?.access || []
      blockToToolsMapping[blockType] = blockTools
    })

  // Add special blocks that aren't in the standard registry
  const specialBlocks = {
    loop: {
      tools: [], // Loop blocks don't use standard tools
    },
    parallel: {
      tools: [], // Parallel blocks don't use standard tools
    },
  }

  // Add special blocks
  Object.entries(specialBlocks).forEach(([blockType, blockInfo]) => {
    blockToToolsMapping[blockType] = blockInfo.tools
  })

  const totalBlocks = Object.keys(blockRegistry).length + Object.keys(specialBlocks).length
  const includedBlocks = Object.keys(blockToToolsMapping).length

  logger.info(`Successfully mapped ${includedBlocks} blocks to their tools`, {
    totalBlocks,
    includedBlocks,
    outputMapping: blockToToolsMapping,
  })

  return blockToToolsMapping
}
