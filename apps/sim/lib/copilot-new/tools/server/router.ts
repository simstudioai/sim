import { z } from 'zod'
import { getAllBlocks } from '@/blocks/registry'
import type { BaseServerTool } from '@/lib/copilot-new/tools/server/base-tool'
import { createLogger } from '@/lib/logs/console/logger'

// Generic execute response schemas (success path only for this route; errors handled via HTTP status)
export const ExecuteResponseSuccessSchema = z.object({ success: z.literal(true), result: z.unknown() })
export type ExecuteResponseSuccess = z.infer<typeof ExecuteResponseSuccessSchema>

// Define server tool registry for the new copilot runtime
const serverToolRegistry: Record<string, BaseServerTool<any, any>> = {}
const logger = createLogger('ServerToolRouter')

// Tool: get_blocks_and_tools
export const GetBlocksAndToolsInput = z.object({})
export const GetBlocksAndToolsResult = z.object({
  blocks: z.array(z.object({ id: z.string(), type: z.string(), name: z.string() }).passthrough()),
  tools: z.array(z.object({ id: z.string(), type: z.string(), name: z.string() }).passthrough()),
})
export type GetBlocksAndToolsResultType = z.infer<typeof GetBlocksAndToolsResult>

const getBlocksAndToolsTool: BaseServerTool<z.infer<typeof GetBlocksAndToolsInput>, z.infer<typeof GetBlocksAndToolsResult>> = {
  name: 'get_blocks_and_tools',
  async execute(_args) {
    logger.debug('Executing get_blocks_and_tools')
    const allBlocks = getAllBlocks()
    logger.debug('Fetched all blocks', { count: allBlocks.length })
    // Split by category fields expected in block configs
    const blocks = allBlocks.filter((b: any) => b.category === 'blocks').map((b: any) => ({
      id: b.id || b.type || b.name || 'unknown',
      type: b.type || b.id || 'unknown',
      name: b.title || b.name || b.type || 'Block',
      ...b,
    }))
    const tools = allBlocks.filter((b: any) => b.category === 'tools').map((b: any) => ({
      id: b.id || b.type || b.name || 'unknown',
      type: b.type || b.id || 'unknown',
      name: b.title || b.name || b.type || 'Tool',
      ...b,
    }))
    logger.debug('Split blocks and tools', {
      blocksCount: blocks.length,
      toolsCount: tools.length,
      sampleBlock: blocks[0] ? { id: blocks[0].id, type: blocks[0].type } : undefined,
      sampleTool: tools[0] ? { id: tools[0].id, type: tools[0].type } : undefined,
    })
    return { blocks, tools }
  },
}

serverToolRegistry[getBlocksAndToolsTool.name] = getBlocksAndToolsTool

// Main router function
export async function routeExecution(toolName: string, payload: unknown): Promise<any> {
  const tool = serverToolRegistry[toolName]
  if (!tool) {
    throw new Error(`Unknown server tool: ${toolName}`)
  }
  // Validate input per tool (where applicable)
  if (toolName === 'get_blocks_and_tools') {
    logger.debug('Routing to get_blocks_and_tools with payload', {
      payloadPreview: (() => {
        try { return JSON.stringify(payload).slice(0, 200) } catch { return undefined }
      })(),
    })
    GetBlocksAndToolsInput.parse(payload || {})
    const result = await tool.execute({})
    return GetBlocksAndToolsResult.parse(result)
  }
  // Default passthrough
  logger.debug('Routing to generic tool', { toolName })
  return tool.execute(payload as any)
}
