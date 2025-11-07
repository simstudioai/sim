import { createLogger } from '@/lib/logs/console/logger'
import { getBlock } from '@/blocks/index'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'
import { executeTool } from '@/tools'
import { getTool } from '@/tools/utils'

const logger = createLogger('GenericBlockHandler')

export class GenericBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return true
  }

  async execute(
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>
  ): Promise<any> {
    const isMcpTool = block.config.tool?.startsWith('mcp-')
    let tool = null

    if (!isMcpTool) {
      tool = getTool(block.config.tool)
      if (!tool) {
        throw new Error(`Tool not found: ${block.config.tool}`)
      }
    }

    let finalInputs = { ...inputs }

    const blockType = block.metadata?.id
    if (blockType) {
      const blockConfig = getBlock(blockType)
      if (blockConfig?.tools?.config?.params) {
        try {
          const transformedParams = blockConfig.tools.config.params(inputs)
          finalInputs = { ...inputs, ...transformedParams }
        } catch (error) {
          logger.warn(`Failed to apply parameter transformation for block type ${blockType}:`, {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }

    try {
      const result = await executeTool(
        block.config.tool,
        {
          ...finalInputs,
          _context: {
            workflowId: ctx.workflowId,
            workspaceId: ctx.workspaceId,
            executionId: ctx.executionId,
          },
        },
        false,
        false,
        ctx
      )

      if (!result.success) {
        const errorDetails = []
        if (result.error) errorDetails.push(result.error)

        const errorMessage =
          errorDetails.length > 0
            ? errorDetails.join(' - ')
            : `Block execution of ${tool?.name || block.config.tool} failed with no error message`

        const error = new Error(errorMessage)

        Object.assign(error, {
          toolId: block.config.tool,
          toolName: tool?.name || 'Unknown tool',
          blockId: block.id,
          blockName: block.metadata?.name || 'Unnamed Block',
          output: result.output || {},
          timestamp: new Date().toISOString(),
        })

        throw error
      }

      const output = result.output
      let cost = null

      if (block.config.tool?.startsWith('knowledge_') && output?.cost) {
        cost = output.cost
      }

      if (cost) {
        return {
          ...output,
          cost: {
            input: cost.input,
            output: cost.output,
            total: cost.total,
          },
          tokens: cost.tokens,
          model: cost.model,
        }
      }

      return output
    } catch (error: any) {
      if (!error.message || error.message === 'undefined (undefined)') {
        let errorMessage = `Block execution of ${tool?.name || block.config.tool} failed`

        if (block.metadata?.name) {
          errorMessage += `: ${block.metadata.name}`
        }

        if (error.status) {
          errorMessage += ` (Status: ${error.status})`
        }

        error.message = errorMessage
      }

      if (typeof error === 'object' && error !== null) {
        if (!error.toolId) error.toolId = block.config.tool
        if (!error.blockName) error.blockName = block.metadata?.name || 'Unnamed Block'
      }

      throw error
    }
  }
}
