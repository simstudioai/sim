import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { projectToolErrorMessageForCopilot } from '@/lib/copilot/request/tools/resolved-secret-result'
import type { ToolExecutionResult, ToolHandler } from '@/lib/copilot/tool-executor/types'
import { routeExecution } from '@/lib/copilot/tools/server/router'

const logger = createLogger('ServerToolAdapter')

export function createServerToolHandler(toolId: string): ToolHandler {
  return async (params, context): Promise<ToolExecutionResult> => {
    const enrichedParams = { ...params }
    if (!enrichedParams.workflowId && context.workflowId)
      enrichedParams.workflowId = context.workflowId
    if (context.workspaceId) enrichedParams.workspaceId = context.workspaceId

    try {
      const result = await routeExecution(toolId, enrichedParams, {
        userId: context.userId,
        workspaceId: context.workspaceId,
        executionId: context.executionId,
        toolCallId: context.toolCallId,
        copilotToolExecution: context.copilotToolExecution,
        billingAttribution: context.billingAttribution,
        userPermission: context.userPermission ?? undefined,
        secretActorUserId: context.secretActorUserId,
        chatId: context.chatId,
        messageId: context.messageId,
        parentToolCallId: context.parentToolCallId,
        abortSignal: context.abortSignal,
        resolvedSecretTraceRegistry: context.resolvedSecretTraceRegistry,
        userStopSignal: context.userStopSignal,
      })

      const rec =
        result && typeof result === 'object' && !Array.isArray(result)
          ? (result as Record<string, unknown>)
          : null
      if (rec?.success === false) {
        const message =
          (typeof rec.error === 'string' && rec.error) ||
          (typeof rec.message === 'string' && rec.message) ||
          `${toolId} failed`
        return { success: false, error: message, output: result }
      }
      return { success: true, output: result }
    } catch (error) {
      const message = toError(error).message
      logger.error('Server tool execution failed', {
        toolId,
        error: projectToolErrorMessageForCopilot(message, context.resolvedSecretTraceRegistry),
        abortSignalAborted: context.abortSignal?.aborted ?? false,
        userStopSignalAborted: context.userStopSignal?.aborted ?? false,
      })
      return {
        success: false,
        error: `[${toolId}] ${message}`,
      }
    }
  }
}
