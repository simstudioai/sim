import { DEFAULT_EXECUTION_TIMEOUT_MS } from '@/lib/execution/constants'
import { DEFAULT_CODE_LANGUAGE } from '@/lib/execution/languages'
import { createLogger } from '@/lib/logs/console/logger'
import { BlockType } from '@/executor/consts'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import { collectBlockData } from '@/executor/utils/block-data'
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

    const { blockData, blockNameMapping } = collectBlockData(context)

    const result = await executeTool(
      'function_execute',
      {
        code: codeContent,
        language: inputs.language || DEFAULT_CODE_LANGUAGE,
        useLocalVM: !inputs.remoteExecution,
        timeout: inputs.timeout || DEFAULT_EXECUTION_TIMEOUT_MS,
        envVars: context.environmentVariables || {},
        workflowVariables: context.workflowVariables || {},
        blockData,
        blockNameMapping,
        _context: {
          workflowId: context.workflowId,
          workspaceId: context.workspaceId,
        },
      },
      false,
      false,
      context
    )

    if (!result.success) {
      throw new Error(result.error || 'Function execution failed')
    }

    return result.output
  }
}
