import {
  normalizeRecord,
  normalizeStringRecord,
  normalizeWorkflowVariables,
} from '@/lib/core/utils/records'
import { DEFAULT_EXECUTION_TIMEOUT_MS } from '@/lib/execution/constants'
import { DEFAULT_CODE_LANGUAGE } from '@/lib/execution/languages'
import { BlockType } from '@/executor/constants'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import { collectBlockData } from '@/executor/utils/block-data'
import {
  FUNCTION_BLOCK_CONTEXT_VARS_KEY,
  FUNCTION_BLOCK_DISPLAY_CODE_KEY,
} from '@/executor/variables/resolver'
import type { SerializedBlock } from '@/serializer/types'
import { executeTool } from '@/tools'

function readCodeContent(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) =>
        entry && typeof entry === 'object' && typeof entry.content === 'string' ? entry.content : ''
      )
      .join('\n')
  }

  return undefined
}

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
    const codeContent = readCodeContent(inputs.code) ?? inputs.code
    const sourceCode =
      readCodeContent(inputs[FUNCTION_BLOCK_DISPLAY_CODE_KEY]) ??
      readCodeContent((block.config?.params as Record<string, unknown> | undefined)?.code)

    const { blockNameMapping, blockOutputSchemas } = collectBlockData(ctx)

    const contextVariables = normalizeRecord(inputs[FUNCTION_BLOCK_CONTEXT_VARS_KEY])

    const toolParams = {
      code: codeContent,
      ...(sourceCode ? { sourceCode } : {}),
      language: inputs.language || DEFAULT_CODE_LANGUAGE,
      timeout: inputs.timeout || DEFAULT_EXECUTION_TIMEOUT_MS,
      envVars: normalizeStringRecord(ctx.environmentVariables),
      workflowVariables: normalizeWorkflowVariables(ctx.workflowVariables),
      blockData: {},
      blockNameMapping,
      blockOutputSchemas,
      contextVariables,
      _context: {
        workflowId: ctx.workflowId,
        workspaceId: ctx.workspaceId,
        executionId: ctx.executionId,
        largeValueExecutionIds: ctx.largeValueExecutionIds,
        allowLargeValueWorkflowScope: ctx.allowLargeValueWorkflowScope,
        userId: ctx.userId,
        isDeployedContext: ctx.isDeployedContext,
        enforceCredentialAccess: ctx.enforceCredentialAccess,
      },
    }

    const result = await executeTool('function_execute', toolParams, { executionContext: ctx })

    if (!result.success) {
      throw new Error(result.error || 'Function execution failed')
    }

    return result.output
  }
}
