import { toError } from '@sim/utils/errors'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { performCreateCredential } from '@/lib/credentials/orchestration'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { SLACK_CUSTOM_BOT_PROVIDER_ID } from '@/lib/oauth/types'
import { buildSlackCustomBotRequestUrl } from '@/triggers/webhook-url'

/**
 * Mints a reusable Slack custom-bot credential from secrets ALREADY stored as
 * environment variables (a v1 setup being migrated, or values saved via
 * set_environment_variables after a browser-agent extraction). The agent
 * passes env-var NAMES; the values are resolved here and validated by the
 * credential orchestration (Slack auth.test), so no secret ever appears in
 * tool args, checkpoints, or transcripts. When the USER holds the secrets,
 * the service_account credential card is the right path instead.
 */
export function executeConnectSlackBot(
  rawParams: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const params = rawParams as {
    displayName?: string
    description?: string
    signingSecretEnvVar?: string
    botTokenEnvVar?: string
  }
  return (async () => {
    try {
      if (!context?.userId) {
        return { success: false, error: 'Authentication required' }
      }
      const workspaceId = context.workspaceId
      if (!workspaceId) {
        return { success: false, error: 'Workspace scope required' }
      }
      const { displayName, description, signingSecretEnvVar, botTokenEnvVar } = params
      if (!displayName) {
        return { success: false, error: 'displayName is required' }
      }
      if (!signingSecretEnvVar || !botTokenEnvVar) {
        return {
          success: false,
          error:
            'signingSecretEnvVar and botTokenEnvVar are required: the NAMES of the environment variables holding the Slack signing secret and bot token. Save the values with set_environment_variables first if needed.',
        }
      }

      const env = await getEffectiveDecryptedEnv(context.userId, workspaceId)
      const missing = [signingSecretEnvVar, botTokenEnvVar].filter((name) => !env[name])
      if (missing.length > 0) {
        return {
          success: false,
          error: `Environment variable(s) not found: ${missing.join(', ')}. Check environment/ in the VFS, or save the values with set_environment_variables first.`,
        }
      }

      const result = await performCreateCredential({
        workspaceId,
        userId: context.userId,
        type: 'service_account',
        providerId: SLACK_CUSTOM_BOT_PROVIDER_ID,
        displayName,
        description,
        signingSecret: env[signingSecretEnvVar],
        botToken: env[botTokenEnvVar],
      })
      if (!result.success || !result.credential) {
        return {
          success: false,
          error:
            result.error ||
            'Failed to connect the Slack custom bot. If a credential with this display name already exists, reuse it (environment/credentials.json) or pick a different name.',
        }
      }
      return {
        success: true,
        output: {
          credentialId: result.credential.id,
          displayName: result.credential.displayName,
          created: result.created !== false,
          // The Slack app's Event Subscriptions Request URL — one per
          // credential, shared by every trigger that selects it; live
          // immediately, no deployment needed.
          requestUrl: buildSlackCustomBotRequestUrl(result.credential.id),
        },
      }
    } catch (error) {
      return { success: false, error: toError(error).message }
    }
  })()
}
