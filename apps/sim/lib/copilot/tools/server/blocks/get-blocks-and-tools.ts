import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import {
  type GetBlocksAndToolsInput,
  GetBlocksAndToolsResult,
} from '@/lib/copilot/tools/shared/schemas'
import { createLogger } from '@/lib/logs/console/logger'
import { registry as blockRegistry } from '@/blocks/registry'
import type { BlockConfig } from '@/blocks/types'

export const getBlocksAndToolsServerTool: BaseServerTool<
  ReturnType<typeof GetBlocksAndToolsInput.parse>,
  ReturnType<typeof GetBlocksAndToolsResult.parse>
> = {
  name: 'get_blocks_and_tools',
  async execute() {
    const logger = createLogger('GetBlocksAndToolsServerTool')
    logger.debug('Executing get_blocks_and_tools')

    type BlockListItem = {
      type: string
      name: string
      description?: string
      triggerAllowed?: boolean
    }
    const blocks: BlockListItem[] = []

    Object.entries(blockRegistry)
      .filter(([, blockConfig]: [string, BlockConfig]) => !blockConfig.hideFromToolbar)
      .forEach(([blockType, blockConfig]: [string, BlockConfig]) => {
        blocks.push({
          type: blockType,
          name: blockConfig.name,
          description: blockConfig.longDescription,
          triggerAllowed: 'triggerAllowed' in blockConfig ? !!blockConfig.triggerAllowed : false,
        })
      })

    const specialBlocks: Record<string, { name: string; description: string }> = {
      loop: {
        name: 'Loop',
        description:
          'Control flow block for iterating over collections or repeating actions in a loop',
      },
      parallel: {
        name: 'Parallel',
        description: 'Control flow block for executing multiple branches simultaneously',
      },
    }
    Object.entries(specialBlocks).forEach(([blockType, info]) => {
      if (!blocks.some((b) => b.type === blockType)) {
        blocks.push({
          type: blockType,
          name: info.name,
          description: info.description,
        })
      }
    })

    return GetBlocksAndToolsResult.parse({ blocks })
  },
}
