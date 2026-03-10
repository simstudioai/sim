import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import type {
  ExecutionContext,
  ToolCallResult,
  ToolCallState,
} from '@/lib/copilot/orchestrator/types'
import { isHosted } from '@/lib/core/config/feature-flags'
import { generateRequestId } from '@/lib/core/utils/request'
import { getCredentialActorContext } from '@/lib/credentials/access'
import { getAccessibleOAuthCredentials } from '@/lib/credentials/environment'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { getWorkflowById } from '@/lib/workflows/utils'
import { refreshTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import { resolveEnvVarReferences } from '@/executor/utils/reference-validation'
import { executeTool } from '@/tools'
import type { ToolConfig } from '@/tools/types'
import { resolveToolId } from '@/tools/utils'

const logger = createLogger('CopilotIntegrationTools')

export async function executeIntegrationToolDirect(
  toolCall: ToolCallState,
  toolConfig: ToolConfig,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const { userId, workflowId } = context
  const toolName = resolveToolId(toolCall.name)
  const toolArgs = toolCall.params || {}

  let workspaceId = context.workspaceId
  if (!workspaceId && workflowId) {
    const wf = await getWorkflowById(workflowId)
    workspaceId = wf?.workspaceId ?? undefined
  }

  const decryptedEnvVars =
    context.decryptedEnvVars || (await getEffectiveDecryptedEnv(userId, workspaceId))

  const executionParams = resolveEnvVarReferences(toolArgs, decryptedEnvVars, {
    deep: true,
  }) as Record<string, unknown>

  // If the LLM passed a credential/oauthCredential ID directly, verify the user
  // has active credential_member access before proceeding. This prevents
  // unauthorized credential usage even if the agent hallucinated or received
  // a credential ID the user doesn't have access to.
  const suppliedCredentialId = (executionParams.oauthCredential || executionParams.credential) as
    | string
    | undefined
  if (suppliedCredentialId) {
    const actorCtx = await getCredentialActorContext(suppliedCredentialId, userId)
    if (!actorCtx.member) {
      logger.warn('Blocked credential use: user lacks credential_member access', {
        credentialId: suppliedCredentialId,
        userId,
        toolName,
      })
      return {
        success: false,
        error: `You do not have access to credential "${suppliedCredentialId}". Ask the credential admin to add you as a member, or connect your own account.`,
      }
    }
  }

  if (toolConfig.oauth?.required && toolConfig.oauth.provider) {
    const provider = toolConfig.oauth.provider

    // If the user already supplied a credential ID that passed the check above,
    // skip auto-resolution and let executeTool handle it via the token endpoint.
    if (!suppliedCredentialId) {
      if (!workspaceId) {
        return {
          success: false,
          error: `Cannot resolve ${provider} credential without a workspace context.`,
        }
      }

      const accessibleCreds = await getAccessibleOAuthCredentials(workspaceId, userId)
      const match = accessibleCreds.find((c) => c.providerId === provider)

      if (!match) {
        return {
          success: false,
          error: `No accessible ${provider} account found. You either don't have a ${provider} account connected in this workspace, or you don't have access to the existing one. Please connect your own account.`,
        }
      }

      // Resolve the credential to its underlying account for token refresh
      const matchCtx = await getCredentialActorContext(match.id, userId)
      const accountId = matchCtx.credential?.accountId
      if (!accountId) {
        return {
          success: false,
          error: `OAuth account for ${provider} not found. Please reconnect your account.`,
        }
      }

      const [acc] = await db.select().from(account).where(eq(account.id, accountId)).limit(1)

      if (!acc) {
        return {
          success: false,
          error: `OAuth account for ${provider} not found. Please reconnect your account.`,
        }
      }

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
  }

  const hasHostedKeySupport = isHosted && !!toolConfig.hosting
  if (toolConfig.params?.apiKey?.required && !executionParams.apiKey && !hasHostedKeySupport) {
    return {
      success: false,
      error: `API key not provided for ${toolName}. Use {{YOUR_API_KEY_ENV_VAR}} to reference your environment variable.`,
    }
  }

  executionParams._context = {
    workflowId,
    workspaceId,
    userId,
    enforceCredentialAccess: true,
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
