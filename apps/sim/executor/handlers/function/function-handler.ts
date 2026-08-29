import { normalizeSecretMountPolicy } from '@/lib/copilot/secret-mount-policy'
import { getRemainingExecutionMs } from '@/lib/core/execution-limits'
import {
  normalizeRecord,
  normalizeStringRecord,
  normalizeWorkflowVariables,
} from '@/lib/core/utils/records'
import { DEFAULT_EXECUTION_TIMEOUT_MS } from '@/lib/execution/constants'
import { DEFAULT_CODE_LANGUAGE } from '@/lib/execution/languages'
import { NonRetryableExecutionError } from '@/lib/execution/non-retryable-error'
import { mergeFileKeys, mergeLargeValueKeys } from '@/lib/execution/payloads/access-keys'
import { BlockType } from '@/executor/constants'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import { collectBlockData } from '@/executor/utils/block-data'
import { attachTrustedExecutionCost } from '@/executor/utils/errors'
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
    const requestedTimeout =
      typeof inputs.timeout === 'number' && Number.isFinite(inputs.timeout) && inputs.timeout > 0
        ? inputs.timeout
        : undefined
    const remainingExecutionMs = getRemainingExecutionMs(ctx.abortSignal)
    const timeout =
      remainingExecutionMs === undefined
        ? (requestedTimeout ?? DEFAULT_EXECUTION_TIMEOUT_MS)
        : Math.max(
            1,
            requestedTimeout === undefined
              ? remainingExecutionMs
              : Math.min(requestedTimeout, remainingExecutionMs)
          )
    const secretMountPolicy =
      inputs.secretScope === undefined
        ? undefined
        : normalizeSecretMountPolicy({
            secretScope: inputs.secretScope,
            mountedSecrets: inputs.mountedSecrets,
          })

    const unredactedSecretNames = ctx.resolvedSecretTraceRegistry?.getUnredactedSecretNames() ?? []

    const toolParams = {
      code: codeContent,
      ...(sourceCode ? { sourceCode } : {}),
      language: inputs.language || DEFAULT_CODE_LANGUAGE,
      timeout,
      ...(inputs.sandboxId ? { sandboxId: inputs.sandboxId } : {}),
      ...(secretMountPolicy ?? {}),
      ...(unredactedSecretNames.length > 0 ? { unredactedSecretNames } : {}),
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
        largeValueKeys: ctx.largeValueKeys,
        fileKeys: ctx.fileKeys,
        allowLargeValueWorkflowScope: ctx.allowLargeValueWorkflowScope,
        userId: ctx.userId,
        isDeployedContext: ctx.isDeployedContext,
        enforceCredentialAccess: ctx.enforceCredentialAccess,
      },
    }

    const result = await executeTool('function_execute', toolParams, { executionContext: ctx })

    if (!result.success) {
      const error =
        result.retryable === false
          ? new NonRetryableExecutionError(result.error || 'Function execution is indeterminate')
          : new Error(result.error || 'Function execution failed')
      attachTrustedExecutionCost(error, result.output?.cost)
      throw error
    }

    mergeLargeValueKeys(ctx, result.largeValueKeys ?? [])
    mergeFileKeys(ctx, result.fileKeys ?? [])

    attachTrustedExecutionCost(result.output, result.output?.cost)
    return result.output
  }
}
