import { messageForCopilotApplicationError } from '@/lib/copilot/application/error'
import { executeCopilotCredentialUseCase } from '@/lib/copilot/application/execute-credential-use-case'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { prepareCredentialConnection } from '@/lib/credentials/application/prepare-credential-connection'
import { isServiceAccountProviderId } from '@/lib/credentials/service-account-provider-ids'
import { APP_ENTRY_PATH } from '@/lib/navigation/paths'

export async function executeOAuthGetAuthLink(
  rawParams: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const providerName = String(rawParams.providerName || rawParams.provider_name || '')
  const rawCredentialId = rawParams.credentialId || rawParams.credential_id
  const credentialId = rawCredentialId ? String(rawCredentialId) : undefined
  const baseUrl = getBaseUrl()

  /** Reject service-account aliases before the provider resolver's fuzzy OAuth match. */
  const serviceAccountId = providerName
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
  if (isServiceAccountProviderId(serviceAccountId)) {
    if (context.requestMode === 'assistant') {
      const message =
        'Assistant uses your own connected accounts. A service account cannot be used here.'
      return { success: false, error: message, output: { message } }
    }
    const message =
      `"${providerName}" is a service account, not an OAuth provider. ` +
      `Emit a service_account credential tag with the service's OAuth provider ` +
      `value instead (e.g. "slack") — it opens the service account setup form in chat.`
    return { success: false, error: message, output: { message } }
  }
  const workspaceId = context.workspaceId
  if (!workspaceId) return { success: false, error: 'workspaceId is required' }

  try {
    const result = await executeCopilotCredentialUseCase(context, prepareCredentialConnection, {
      workspaceId,
      providerName,
      credentialId,
      ...(context.requestMode === 'assistant' ? { personalOnly: true } : {}),
    })
    if (context.requestMode === 'assistant') {
      return {
        success: true,
        output: {
          message: `Connect your ${result.serviceName} account using the in-chat connection card.`,
          provider: result.serviceName,
          providerId: result.providerId,
          instructions: `End your response with <credential>${JSON.stringify({ type: 'link', provider: result.providerId })}</credential>. The card connects the signed-in person's account to Connected accounts. Wait for the connection status before continuing.`,
        },
      }
    }
    const callbackURL = context.workflowId
      ? `${baseUrl}/workspace/${workspaceId}/w/${context.workflowId}`
      : context.chatId
        ? `${baseUrl}/workspace/${workspaceId}/chat/${context.chatId}`
        : `${baseUrl}/workspace/${workspaceId}`
    const authorizeUrl = new URL(`${baseUrl}/api/auth/oauth2/authorize`)
    authorizeUrl.searchParams.set('providerId', result.providerId)
    authorizeUrl.searchParams.set('workspaceId', workspaceId)
    authorizeUrl.searchParams.set('callbackURL', callbackURL)
    if (result.credentialId) authorizeUrl.searchParams.set('credentialId', result.credentialId)

    const action = credentialId ? 'reconnect' : 'connect'
    return {
      success: true,
      output: {
        message: credentialId
          ? `Reconnect authorization URL generated for ${result.serviceName}. Completing it re-authorizes credential ${credentialId} in place — its id stays the same.`
          : `Authorization URL generated for ${result.serviceName}.`,
        oauth_url: authorizeUrl.toString(),
        instructions: `Open this URL in your browser to ${action} ${result.serviceName}: ${authorizeUrl.toString()}`,
        provider: result.serviceName,
        providerId: result.providerId,
      },
    }
  } catch (err) {
    const message = messageForCopilotApplicationError(err)
    if (context.requestMode === 'assistant') {
      return { success: false, error: message, output: { message } }
    }
    const workspaceUrl = context.workspaceId
      ? `${baseUrl}/workspace/${context.workspaceId}`
      : `${baseUrl}${APP_ENTRY_PATH}`
    return {
      success: false,
      error: message,
      output: {
        message: `Could not generate a direct OAuth link for ${providerName}. Connect manually from the workspace.`,
        oauth_url: workspaceUrl,
        error: message,
      },
    }
  }
}

/** Compatibility executor for older Mothership calls and persisted checkpoints. */
export async function executeOAuthRequestAccess(
  rawParams: Record<string, unknown>,
  _context: ExecutionContext
): Promise<ToolCallResult> {
  const providerName = String(rawParams.providerName || rawParams.provider_name || 'the provider')
  return {
    success: true,
    output: {
      status: 'requested',
      providerName,
      message: `Requested ${providerName} OAuth connection.`,
    },
  }
}
