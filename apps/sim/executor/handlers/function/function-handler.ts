import { createLogger } from '@/lib/logs/console-logger'
import { BlockType } from '@/executor/consts'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'
import { executeTool } from '@/tools'

const logger = createLogger('FunctionBlockHandler')

/**
 * Handler for Function blocks that execute custom code.
 */
export class FunctionBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === BlockType.FUNCTION
  }

  async execute(
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<any> {
    const codeContent = Array.isArray(inputs.code)
      ? inputs.code.map((c: { content: string }) => c.content).join('\n')
      : inputs.code

    // Extract block data for variable resolution
    const blockData: Record<string, any> = {}
    const blockNameMapping: Record<string, string> = {}

    for (const [blockId, blockState] of context.blockStates.entries()) {
      if (blockState.output) {
        blockData[blockId] = blockState.output

        // Try to find the block name from the workflow
        const workflowBlock = context.workflow?.blocks?.find((b) => b.id === blockId)
        if (workflowBlock?.metadata?.name) {
          blockNameMapping[workflowBlock.metadata.name] = blockId
        }
      }
    }

    // Directly use the function_execute tool which calls the API route
    const result = await executeTool('function_execute', {
      code: codeContent,
      timeout: inputs.timeout || 5000,
      envVars: context.environmentVariables || {},
      blockData: blockData, // Pass block data for variable resolution
      blockNameMapping: blockNameMapping, // Pass block name to ID mapping
      _context: { workflowId: context.workflowId },
    })

    if (!result.success) {
      throw new Error(result.error || 'Function execution failed')
    }

    return result.output
  }
}
