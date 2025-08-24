import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import {
  type GetBlocksAndToolsInput,
  GetBlocksAndToolsResult,
} from '@/lib/copilot/tools/shared/schemas'
import { createLogger } from '@/lib/logs/console/logger'
import { registry as blockRegistry } from '@/blocks/registry'
import { tools as toolsRegistry } from '@/tools/registry'

export const getBlocksAndToolsServerTool: BaseServerTool<
  ReturnType<typeof GetBlocksAndToolsInput.parse>,
  ReturnType<typeof GetBlocksAndToolsResult.parse>
> = {
  name: 'get_blocks_and_tools',
  async execute() {
    const logger = createLogger('GetBlocksAndToolsServerTool')
    logger.debug('Executing get_blocks_and_tools')

    const blocks: any[] = []

    Object.entries(blockRegistry)
      .filter(([_, blockConfig]: any) => {
        if ((blockConfig as any).hideFromToolbar) return false
        return true
      })
      .forEach(([blockType, blockConfig]: any) => {
        blocks.push({ id: blockType, type: blockType, name: blockConfig.name || blockType })
      })

    const specialBlocks = { loop: { name: 'Loop' }, parallel: { name: 'Parallel' } }
    Object.entries(specialBlocks).forEach(([blockType, info]) => {
      if (!blocks.some((b) => b.id === blockType)) {
        blocks.push({ id: blockType, type: blockType, name: (info as any).name })
      }
    })

    const tools: any[] = Object.entries(toolsRegistry).map(([toolId, toolConfig]: any) => ({
      id: toolId,
      type: toolId,
      name: toolConfig?.name || toolId,
    }))

    return GetBlocksAndToolsResult.parse({ blocks, tools })
  },
}
