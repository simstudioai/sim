import { createLogger } from '@sim/logger'
import { createServiceAccountCredentialUseCase } from '@/lib/credentials/application/service-account'
import { messageForCopilotApplicationError } from '@/lib/mothership/application/error'
import { executeCopilotCredentialUseCase } from '@/lib/mothership/application/execute-credential-use-case'
import { ConnectSlackBotInputSchema } from '@/lib/mothership/generated/protocol'
import type { ToolHandler } from '@/lib/mothership/tool-executor/types'
import { requireCopilotWorkspace } from '@/lib/mothership/tools/server/workspace-scope'
import { buildSlackCustomBotRequestUrl } from '@/triggers/webhook-url'

const logger = createLogger('ConnectSlackBot')

/** Resolve names on Sim and return only the created credential's public connection metadata. */
export const executeConnectSlackBot: ToolHandler = async (params, context) => {
  const parsed = ConnectSlackBotInputSchema.safeParse(params)
  if (!parsed.success) {
    return {
      success: false,
      error: 'Provide a displayName and the names of both stored Slack secrets',
    }
  }
  try {
    context.abortSignal?.throwIfAborted()
    const workspaceId = requireCopilotWorkspace(context)
    const { displayName, description, signingSecretEnvVar, botTokenEnvVar } = parsed.data
    const result = await executeCopilotCredentialUseCase(
      context,
      createServiceAccountCredentialUseCase,
      {
        workspaceId,
        displayName,
        description,
        storedSlackSecrets: { signingSecretEnvVar, botTokenEnvVar },
      }
    )
    return {
      success: true,
      output: {
        credentialId: result.credential.id,
        displayName: result.credential.displayName,
        created: result.created,
        requestUrl: buildSlackCustomBotRequestUrl(result.credential.id),
      },
    }
  } catch (error) {
    logger.error('Slack bot connection failed', { error })
    return {
      success: false,
      error: messageForCopilotApplicationError(error, 'Could not connect Slack bot'),
    }
  }
}
