import { createLogger } from '@/lib/logs/console-logger'
import { BlockOutput } from '@/blocks/types'
import { SerializedBlock } from '@/serializer/types'
import { executeTool } from '@/tools'
import { getTool } from '@/tools/utils'
import { BlockHandler, ExecutionContext } from '../../types'

const logger = createLogger('GenericBlockHandler')

/**
 * Generic handler for any block types not covered by specialized handlers.
 * Acts as a fallback for custom or future block types.
 */
export class GenericBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    // This handler can handle any block, so it always returns true.
    // It should be the last handler checked.
    return true
  }

  async execute(
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<BlockOutput> {
    logger.info(`Executing block: ${block.id} (Type: ${block.metadata?.id})`)
    const tool = getTool(block.config.tool)
    if (!tool) {
      throw new Error(`Tool not found: ${block.config.tool}`)
    }

    try {
      const result = await executeTool(block.config.tool, {
        ...inputs,
        _context: { workflowId: context.workflowId },
      })

      if (!result.success) {
        const errorDetails = []
        if (result.error) errorDetails.push(result.error)

        const errorMessage =
          errorDetails.length > 0
            ? errorDetails.join(' - ')
            : `Block execution of ${tool.name || block.config.tool} failed with no error message`

        // Create a detailed error object with formatted message
        const error = new Error(errorMessage)

        // Add additional properties for debugging
        Object.assign(error, {
          toolId: block.config.tool,
          toolName: tool.name || 'Unknown tool',
          blockId: block.id,
          blockName: block.metadata?.name || 'Unnamed Block',
          output: result.output || {},
          timestamp: new Date().toISOString(),
        })

        throw error
      }

      return { response: result.output }
    } catch (error: any) {
      // Ensure we have a meaningful error message
      if (!error.message || error.message === 'undefined (undefined)') {
        // Construct a detailed error message with available information
        let errorMessage = `Block execution of ${tool.name || block.config.tool} failed`

        // Add block name if available
        if (block.metadata?.name) {
          errorMessage += `: ${block.metadata.name}`
        }

        // Add status code if available
        if (error.status) {
          errorMessage += ` (Status: ${error.status})`
        }

        error.message = errorMessage
      }

      // Add additional context to the error
      if (typeof error === 'object' && error !== null) {
        if (!error.toolId) error.toolId = block.config.tool
        if (!error.blockName) error.blockName = block.metadata?.name || 'Unnamed Block'
      }

      throw error
    }
  }
}
