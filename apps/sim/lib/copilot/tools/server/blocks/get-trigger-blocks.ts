import { z } from 'zod'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { createLogger } from '@/lib/logs/console/logger'
import { registry as blockRegistry } from '@/blocks/registry'
import type { BlockConfig } from '@/blocks/types'

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
      if (blockConfig.hideFromToolbar) return

      if (blockConfig.category === 'triggers') {
        triggerBlockIds.push(blockType)
      } else if ('triggerAllowed' in blockConfig && blockConfig.triggerAllowed === true) {
        triggerBlockIds.push(blockType)
      } else if (blockConfig.subBlocks?.some((subBlock) => subBlock.mode === 'trigger')) {
        triggerBlockIds.push(blockType)
      }
    })

    triggerBlockIds.sort()

    logger.debug(`Found ${triggerBlockIds.length} trigger blocks`)
    return GetTriggerBlocksResult.parse({ triggerBlockIds })
  },
}
