import { db } from '@sim/db'
import { account, workflow } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import type {
  ExecutionContext,
  ToolCallResult,
  ToolCallState,
} from '@/lib/copilot/orchestrator/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { refreshTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import { resolveEnvVarReferences } from '@/executor/utils/reference-validation'
import { executeTool } from '@/tools'
import { resolveToolId } from '@/tools/utils'

export async function executeIntegrationToolDirect(
  toolCall: ToolCallState,
  toolConfig: {
    oauth?: { required?: boolean; provider?: string }
    params?: { apiKey?: { required?: boolean } }
  },
  context: ExecutionContext
): Promise<ToolCallResult> {
  const { userId, workflowId } = context
  const toolName = resolveToolId(toolCall.name)
  const toolArgs = toolCall.params || {}

  let workspaceId = context.workspaceId
  if (!workspaceId && workflowId) {
    const workflowResult = await db
      .select({ workspaceId: workflow.workspaceId })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)
    workspaceId = workflowResult[0]?.workspaceId ?? undefined
  }

  const decryptedEnvVars =
    context.decryptedEnvVars || (await getEffectiveDecryptedEnv(userId, workspaceId))

  // Deep resolution walks nested objects to replace {{ENV_VAR}} references.
  // Safe because tool arguments originate from the LLM (not direct user input)
  // and env vars belong to the user themselves.
  const executionParams = resolveEnvVarReferences(toolArgs, decryptedEnvVars, {
    deep: true,
  }) as Record<string, unknown>

  if (toolConfig.oauth?.required && toolConfig.oauth.provider) {
    const provider = toolConfig.oauth.provider
    const accounts = await db
      .select()
      .from(account)
      .where(and(eq(account.providerId, provider), eq(account.userId, userId)))
      .limit(1)

    if (!accounts.length) {
      return {
        success: false,
        error: `No ${provider} account connected. Please connect your account first.`,
      }
    }

    const acc = accounts[0]
    const requestId = generateRequestId()
    const { accessToken } = await refreshTokenIfNeeded(requestId, acc, acc.id)

    if (!accessToken) {
      return {
        success: false,
        error: `OAuth token not available for ${provider}. Please reconnect your account.`,
      }
    }

    executionParams.accessToken = accessToken
  }

  if (toolConfig.params?.apiKey?.required && !executionParams.apiKey) {
    return {
      success: false,
      error: `API key not provided for ${toolName}. Use {{YOUR_API_KEY_ENV_VAR}} to reference your environment variable.`,
    }
  }

  executionParams._context = {
    workflowId,
    userId,
  }

  if (toolName === 'function_execute') {
    executionParams.envVars = decryptedEnvVars
    executionParams.workflowVariables = {}
    executionParams.blockData = {}
    executionParams.blockNameMapping = {}
    executionParams.language = executionParams.language || 'javascript'
    executionParams.timeout = executionParams.timeout || 30000
  }

  const result = await executeTool(toolName, executionParams)

  return {
    success: result.success,
    output: result.output,
    error: result.error,
  }
}
