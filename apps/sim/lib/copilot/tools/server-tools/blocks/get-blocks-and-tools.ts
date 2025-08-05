import { createLogger } from '@/lib/logs/console/logger'
import { registry as blockRegistry } from '@/blocks/registry'
import { tools as toolsRegistry } from '@/tools/registry'
import { BaseCopilotTool } from '../base'

type GetBlocksAndToolsParams = Record<string, never>

interface BlockInfo {
  block_name: string
  tool_names: string[]
}

class GetBlocksAndToolsTool extends BaseCopilotTool<
  GetBlocksAndToolsParams,
  Record<string, BlockInfo>
> {
  readonly id = 'get_blocks_and_tools'
  readonly displayName = 'Getting block information'

  protected async executeImpl(params: GetBlocksAndToolsParams): Promise<Record<string, BlockInfo>> {
    return getBlocksAndTools()
  }
}

// Export the tool instance
export const getBlocksAndToolsTool = new GetBlocksAndToolsTool()

// Implementation function
async function getBlocksAndTools(): Promise<Record<string, BlockInfo>> {
  const logger = createLogger('GetBlocksAndTools')

  logger.info('Getting all blocks and tools')

  // Create mapping of block_id -> {block_name, tool_names}
  const blockToToolsMapping: Record<string, BlockInfo> = {}

  // Process blocks - filter out hidden blocks and map to their tools
  Object.entries(blockRegistry)
    .filter(([blockType, blockConfig]) => {
      // Filter out hidden blocks
      if (blockConfig.hideFromToolbar) return false
      return true
    })
    .forEach(([blockType, blockConfig]) => {
      // Get the tools for this block
      const blockToolIds = blockConfig.tools?.access || []

      // Map tool IDs to tool names
      const toolNames = blockToolIds.map((toolId) => {
        const toolConfig = toolsRegistry[toolId]
        return toolConfig ? toolConfig.name : toolId // Fallback to ID if name not found
      })

      blockToToolsMapping[blockType] = {
        block_name: blockConfig.name || blockType,
        tool_names: toolNames,
      }
    })

  // Add special blocks that aren't in the standard registry
  const specialBlocks = {
    loop: {
      name: 'Loop',
      tools: [], // Loop blocks don't use standard tools
    },
    parallel: {
      name: 'Parallel',
      tools: [], // Parallel blocks don't use standard tools
    },
  }

  // Add special blocks
  Object.entries(specialBlocks).forEach(([blockType, blockInfo]) => {
    blockToToolsMapping[blockType] = {
      block_name: blockInfo.name,
      tool_names: blockInfo.tools,
    }
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
