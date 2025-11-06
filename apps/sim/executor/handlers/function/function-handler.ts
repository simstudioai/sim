import { DEFAULT_EXECUTION_TIMEOUT_MS } from '@/lib/execution/constants'
import { DEFAULT_CODE_LANGUAGE } from '@/lib/execution/languages'
import { BlockType } from '@/executor/consts'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import { collectBlockData } from '@/executor/utils/block-data'
import type { SerializedBlock } from '@/serializer/types'
import { executeTool } from '@/tools'

/**
 * Handler for Function blocks that execute custom code.
 */
export class FunctionBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === BlockType.FUNCTION
  }

  async execute(
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>
  ): Promise<any> {
    const codeContent = Array.isArray(inputs.code)
      ? inputs.code.map((c: { content: string }) => c.content).join('\n')
      : inputs.code

    const { blockData, blockNameMapping } = collectBlockData(ctx)

    const result = await executeTool(
      'function_execute',
      {
        code: codeContent,
        language: inputs.language || DEFAULT_CODE_LANGUAGE,
        timeout: inputs.timeout || DEFAULT_EXECUTION_TIMEOUT_MS,
        envVars: ctx.environmentVariables || {},
        workflowVariables: ctx.workflowVariables || {},
        blockData,
        blockNameMapping,
        _context: {
          workflowId: ctx.workflowId,
          workspaceId: ctx.workspaceId,
        },
      },
      false,
      false,
      ctx
    )

    if (!result.success) {
      throw new Error(result.error || 'Function execution failed')
    }

    return result.output
  }
}
