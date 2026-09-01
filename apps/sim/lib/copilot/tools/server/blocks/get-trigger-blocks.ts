import { createLogger } from '@sim/logger'
import { z } from 'zod'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { getAllowedIntegrationsFromEnv } from '@/lib/core/config/env-flags'
import { isIntegrationDeploymentAvailableForVisibility } from '@/lib/integrations/availability.server'
import { isBlockTypeAccessControlExempt } from '@/lib/permission-groups/block-access'
import { resolvePermissionGroupConfig } from '@/lib/permission-groups/config-scope.server'
import {
  intersectIntegrationAllowlists,
  resolveAccessControlBlockType,
} from '@/lib/permission-groups/integration-allowlist'
import { getAllBlocks } from '@/blocks/registry'
import { overlayVisibility } from '@/blocks/visibility/context'

export const GetTriggerBlocksInput = z.object({})
export const GetTriggerBlocksResult = z.object({
  triggerBlockIds: z.array(z.string()),
})

export const getTriggerBlocksServerTool: BaseServerTool<
  ReturnType<typeof GetTriggerBlocksInput.parse>,
  ReturnType<typeof GetTriggerBlocksResult.parse>
> = {
  name: 'get_trigger_blocks',
  inputSchema: GetTriggerBlocksInput,
  outputSchema: GetTriggerBlocksResult,
  async execute(_args: unknown, context?: { userId: string; workspaceId?: string }) {
    const logger = createLogger('GetTriggerBlocksServerTool')
    logger.debug('Executing get_trigger_blocks')

    const permissionConfig =
      context?.userId && context?.workspaceId
        ? await resolvePermissionGroupConfig(context.userId, context.workspaceId, undefined)
        : null
    const allowedIntegrations = intersectIntegrationAllowlists(
      permissionConfig?.allowedIntegrations ?? null,
      getAllowedIntegrationsFromEnv()
    )
    const visibility = overlayVisibility()

    const triggerBlockIds: string[] = []

    for (const blockConfig of getAllBlocks()) {
      const blockType = blockConfig.type
      if (blockConfig.hideFromToolbar) continue
      if (!isIntegrationDeploymentAvailableForVisibility(blockType, visibility)) continue
      if (
        allowedIntegrations != null &&
        !isBlockTypeAccessControlExempt(blockType) &&
        !allowedIntegrations.includes(resolveAccessControlBlockType(blockType.toLowerCase()))
      )
        continue

      if (blockConfig.category === 'triggers') {
        triggerBlockIds.push(blockType)
      } else if ('triggerAllowed' in blockConfig && blockConfig.triggerAllowed === true) {
        triggerBlockIds.push(blockType)
      } else if (blockConfig.subBlocks?.some((subBlock) => subBlock.mode === 'trigger')) {
        triggerBlockIds.push(blockType)
      }
    }

    triggerBlockIds.sort()

    logger.debug(`Found ${triggerBlockIds.length} trigger blocks`)
    return GetTriggerBlocksResult.parse({ triggerBlockIds })
  },
}
