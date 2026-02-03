import { createLogger } from '@sim/logger'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import {
  type GetBlockOptionsInputType,
  GetBlockOptionsResult,
  type GetBlockOptionsResultType,
} from '@/lib/copilot/tools/shared/schemas'
import { registry as blockRegistry, getLatestBlock } from '@/blocks/registry'
import { getUserPermissionConfig } from '@/ee/access-control/utils/permission-check'
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

    if (blockId === 'loop') {
      const result = {
        blockId,
        blockName: 'Loop',
        operations: [
          { id: 'for', name: 'For', description: 'Run a fixed number of iterations.' },
          { id: 'forEach', name: 'For each', description: 'Iterate over a collection.' },
          { id: 'while', name: 'While', description: 'Repeat while a condition is true.' },
          {
            id: 'doWhile',
            name: 'Do while',
            description: 'Run once, then repeat while a condition is true.',
          },
        ],
      }
      return GetBlockOptionsResult.parse(result)
    }

    if (blockId === 'parallel') {
      const result = {
        blockId,
        blockName: 'Parallel',
        operations: [
          { id: 'count', name: 'Count', description: 'Run a fixed number of parallel branches.' },
          {
            id: 'collection',
            name: 'Collection',
            description: 'Run one branch per collection item.',
          },
        ],
      }
      return GetBlockOptionsResult.parse(result)
    }

    const permissionConfig = context?.userId ? await getUserPermissionConfig(context.userId) : null
    const allowedIntegrations = permissionConfig?.allowedIntegrations

    if (allowedIntegrations != null && !allowedIntegrations.includes(blockId)) {
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

    const latestBlock = getLatestBlock(blockId)
    const displayName = latestBlock?.name ?? blockConfig.name

    const result = {
      blockId,
      blockName: displayName,
      operations,
    }

    return GetBlockOptionsResult.parse(result)
  },
}
