import { executeTool as executeAppTool } from '@/tools'
import type { ToolExecutionContext, ToolExecutionResult } from '../../tool-executor/types'

export async function executeFunctionExecute(
  params: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const enrichedParams = { ...params }

  if (context.decryptedEnvVars && Object.keys(context.decryptedEnvVars).length > 0) {
    enrichedParams.envVars = {
      ...context.decryptedEnvVars,
      ...((enrichedParams.envVars as Record<string, string>) || {}),
    }
  }

  enrichedParams._context = {
    ...(typeof enrichedParams._context === 'object' && enrichedParams._context !== null
      ? (enrichedParams._context as object)
      : {}),
    userId: context.userId,
    workflowId: context.workflowId,
    workspaceId: context.workspaceId,
    chatId: context.chatId,
    executionId: context.executionId,
    runId: context.runId,
    enforceCredentialAccess: true,
  }

  return executeAppTool('function_execute', enrichedParams, false)
}
