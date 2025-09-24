import { z } from 'zod'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { createLogger } from '@/lib/logs/console/logger'
import { registry as blockRegistry } from '@/blocks/registry'
import type { BlockConfig } from '@/blocks/types'

// Define input and result schemas
export const GetTriggerBlocksInput = z.object({})
export const GetTriggerBlocksResult = z.object({
  triggerBlockIds: z.array(z.string()),
})

export const getTriggerBlocksServerTool: BaseServerTool<
  ReturnType<typeof GetTriggerBlocksInput.parse>,
  ReturnType<typeof GetTriggerBlocksResult.parse>
> = {
  name: 'get_trigger_blocks',
  async execute() {
    const logger = createLogger('GetTriggerBlocksServerTool')
    logger.debug('Executing get_trigger_blocks')

    const triggerBlockIds: string[] = []

    Object.entries(blockRegistry).forEach(([blockType, blockConfig]: [string, BlockConfig]) => {
      // Skip hidden blocks
      if (blockConfig.hideFromToolbar) return

      // Check if it's a trigger block (category: 'triggers')
      if (blockConfig.category === 'triggers') {
        triggerBlockIds.push(blockType)
      }
      // Check if it's a tool with trigger capability (triggerAllowed: true)
      else if ('triggerAllowed' in blockConfig && blockConfig.triggerAllowed === true) {
        triggerBlockIds.push(blockType)
      }
      // Check if it has a trigger-config subblock
      else if (blockConfig.subBlocks?.some((subBlock) => subBlock.type === 'trigger-config')) {
        triggerBlockIds.push(blockType)
      }
    })

    // Sort alphabetically for consistency
    triggerBlockIds.sort()

    logger.debug(`Found ${triggerBlockIds.length} trigger blocks`)
    return GetTriggerBlocksResult.parse({ triggerBlockIds })
  },
}
