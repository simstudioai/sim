import { createLogger } from '@sim/logger'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import {
  type GetBlockOptionsInputType,
  GetBlockOptionsResult,
  type GetBlockOptionsResultType,
} from '@/lib/copilot/tools/shared/schemas'
import { registry as blockRegistry } from '@/blocks/registry'
import { getUserPermissionConfig } from '@/executor/utils/permission-check'
import { tools as toolsRegistry } from '@/tools/registry'

export const getBlockOptionsServerTool: BaseServerTool<
  GetBlockOptionsInputType,
  GetBlockOptionsResultType
> = {
  name: 'get_block_options',
  async execute(
    { blockId }: GetBlockOptionsInputType,
    context?: { userId: string }
  ): Promise<GetBlockOptionsResultType> {
    const logger = createLogger('GetBlockOptionsServerTool')
    logger.debug('Executing get_block_options', { blockId })

    const permissionConfig = context?.userId ? await getUserPermissionConfig(context.userId) : null
    const allowedIntegrations = permissionConfig?.allowedIntegrations

    if (allowedIntegrations !== null && !allowedIntegrations?.includes(blockId)) {
      throw new Error(`Block "${blockId}" is not available`)
    }

    const blockConfig = blockRegistry[blockId]
    if (!blockConfig) {
      throw new Error(`Block not found: ${blockId}`)
    }

    const operations: { id: string; name: string; description?: string }[] = []

    // Check if block has an operation dropdown to determine available operations
    const operationSubBlock = blockConfig.subBlocks?.find((sb) => sb.id === 'operation')
    if (operationSubBlock && Array.isArray(operationSubBlock.options)) {
      // Block has operations - get tool info for each operation
      for (const option of operationSubBlock.options) {
        const opId = typeof option === 'object' ? option.id : option
        const opLabel = typeof option === 'object' ? option.label : option

        // Try to resolve the tool for this operation
        let toolDescription: string | undefined
        try {
          const toolSelector = blockConfig.tools?.config?.tool
          if (typeof toolSelector === 'function') {
            const toolId = toolSelector({ operation: opId })
            const tool = toolsRegistry[toolId]
            if (tool) {
              toolDescription = tool.description
            }
          }
        } catch {
          // Tool resolution failed, continue without description
        }

        operations.push({
          id: opId,
          name: opLabel || opId,
          description: toolDescription,
        })
      }
    } else {
      // No operation dropdown - list all accessible tools
      const accessibleTools = blockConfig.tools?.access || []
      for (const toolId of accessibleTools) {
        const tool = toolsRegistry[toolId]
        if (tool) {
          operations.push({
            id: toolId,
            name: tool.name || toolId,
            description: tool.description,
          })
        }
      }
    }

    const result = {
      blockId,
      blockName: blockConfig.name,
      operations,
    }

    return GetBlockOptionsResult.parse(result)
  },
}
