import { createLogger } from '@sim/logger'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import {
  type GetBlocksAndToolsInput,
  GetBlocksAndToolsResult,
} from '@/lib/copilot/tools/shared/schemas'
import { registry as blockRegistry } from '@/blocks/registry'
import type { BlockConfig } from '@/blocks/types'
import { getUserPermissionConfig } from '@/ee/access-control/utils/permission-check'

export const getBlocksAndToolsServerTool: BaseServerTool<
  ReturnType<typeof GetBlocksAndToolsInput.parse>,
  ReturnType<typeof GetBlocksAndToolsResult.parse>
> = {
  name: 'get_blocks_and_tools',
  async execute(_args: unknown, context?: { userId: string }) {
    const logger = createLogger('GetBlocksAndToolsServerTool')
    logger.debug('Executing get_blocks_and_tools')

    const permissionConfig = context?.userId ? await getUserPermissionConfig(context.userId) : null
    const allowedIntegrations = permissionConfig?.allowedIntegrations

    type BlockListItem = {
      type: string
      name: string
      description?: string
      triggerAllowed?: boolean
    }
    const blocks: BlockListItem[] = []

    Object.entries(blockRegistry)
      .filter(([blockType, blockConfig]: [string, BlockConfig]) => {
        if (blockConfig.hideFromToolbar) return false
        if (allowedIntegrations != null && !allowedIntegrations.includes(blockType)) return false
        return true
      })
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
