import { createLogger } from '@sim/logger'
import { z } from 'zod'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { registry as blockRegistry } from '@/blocks/registry'
import type { BlockConfig } from '@/blocks/types'
import { getUserPermissionConfig } from '@/ee/access-control/utils/permission-check'

export const GetTriggerBlocksInput = z.object({})
export const GetTriggerBlocksResult = z.object({
  triggerBlockIds: z.array(z.string()),
})

export const getTriggerBlocksServerTool: BaseServerTool<
  ReturnType<typeof GetTriggerBlocksInput.parse>,
  ReturnType<typeof GetTriggerBlocksResult.parse>
> = {
  name: 'get_trigger_blocks',
  async execute(_args: unknown, context?: { userId: string }) {
    const logger = createLogger('GetTriggerBlocksServerTool')
    logger.debug('Executing get_trigger_blocks')

    const permissionConfig = context?.userId ? await getUserPermissionConfig(context.userId) : null
    const allowedIntegrations = permissionConfig?.allowedIntegrations

    const triggerBlockIds: string[] = []

    Object.entries(blockRegistry).forEach(([blockType, blockConfig]: [string, BlockConfig]) => {
      if (blockConfig.hideFromToolbar) return
      if (allowedIntegrations != null && !allowedIntegrations.includes(blockType)) return

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
