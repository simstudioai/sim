import { DEFAULT_CODE_LANGUAGE } from '@/lib/execution/languages'
import { createLogger } from '@/lib/logs/console/logger'
import { BlockType } from '@/executor/consts'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'
import { executeTool } from '@/tools'

const logger = createLogger('FunctionBlockHandler')

/**
 * Helper function to collect runtime block outputs and name mappings
 * for tag resolution in function execution
 */
function collectBlockData(context: ExecutionContext): {
  blockData: Record<string, any>
  blockNameMapping: Record<string, string>
} {
  const blockData: Record<string, any> = {}
  const blockNameMapping: Record<string, string> = {}

  for (const [id, state] of context.blockStates.entries()) {
    if (state.output !== undefined) {
      blockData[id] = state.output
      const workflowBlock = context.workflow?.blocks?.find((b) => b.id === id)
      if (workflowBlock?.metadata?.name) {
        // Map both the display name and normalized form
        blockNameMapping[workflowBlock.metadata.name] = id
        const normalized = workflowBlock.metadata.name.replace(/\s+/g, '').toLowerCase()
        blockNameMapping[normalized] = id
      }
    }
  }

  return { blockData, blockNameMapping }
}

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
    const { blockData, blockNameMapping } = collectBlockData(context)

    // Directly use the function_execute tool which calls the API route
    const result = await executeTool(
      'function_execute',
      {
        code: codeContent,
        language: inputs.language || DEFAULT_CODE_LANGUAGE,
        useLocalVM: !inputs.remoteExecution,
        timeout: inputs.timeout || 5000,
        envVars: context.environmentVariables || {},
        workflowVariables: context.workflowVariables || {},
        blockData: blockData, // Pass block data for variable resolution
        blockNameMapping: blockNameMapping, // Pass block name to ID mapping
        _context: {
          workflowId: context.workflowId,
          workspaceId: context.workspaceId,
        },
      },
      false, // skipProxy
      false, // skipPostProcess
      context // execution context for file processing
    )

    if (!result.success) {
      throw new Error(result.error || 'Function execution failed')
    }

    return result.output
  }
}
