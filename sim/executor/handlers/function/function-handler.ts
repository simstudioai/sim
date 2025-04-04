import { createLogger } from '@/lib/logs/console-logger'
import { BlockOutput } from '@/blocks/types'
import { SerializedBlock } from '@/serializer/types'
import { executeTool } from '@/tools'
import { BlockHandler, ExecutionContext } from '../../types'

const logger = createLogger('FunctionBlockHandler')

/**
 * Handler for Function blocks that execute custom code.
 */
export class FunctionBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === 'function'
  }

  async execute(
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<BlockOutput> {
    const codeContent = Array.isArray(inputs.code)
      ? inputs.code.map((c: { content: string }) => c.content).join('\n')
      : inputs.code

    // Directly use the function_execute tool which calls the API route
    logger.info(`Executing function block via API route: ${block.id}`)
    const result = await executeTool('function_execute', {
      code: codeContent,
      timeout: inputs.timeout || 5000,
      _context: { workflowId: context.workflowId },
    })

    if (!result.success) {
      throw new Error(result.error || 'Function execution failed')
    }

    return { response: result.output }
  }
}
