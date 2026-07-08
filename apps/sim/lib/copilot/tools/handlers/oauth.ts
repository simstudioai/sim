import { toError } from '@sim/utils/errors'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { ensureWorkspaceAccess } from '@/lib/copilot/tools/handlers/access'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { getCredentialActorContext } from '@/lib/credentials/access'
import { getAllOAuthServices } from '@/lib/oauth/utils'
import type { WorkspaceAccess } from '@/lib/workspaces/permissions/utils'

export async function executeOAuthGetAuthLink(
  rawParams: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const providerName = String(rawParams.providerName || rawParams.provider_name || '')
  const rawCredentialId = rawParams.credentialId || rawParams.credential_id
  const credentialId = rawCredentialId ? String(rawCredentialId) : undefined
  const baseUrl = getBaseUrl()
  try {
    if (!context.workspaceId || !context.userId) {
      throw new Error('workspaceId and userId are required to generate an OAuth link')
    }
    const workspaceAccess = await ensureWorkspaceAccess(
      context.workspaceId,
      context.userId,
      'write'
    )
    const result = await generateOAuthLink(
      context.workspaceId,
      context.workflowId,
      context.chatId,
      providerName,
      baseUrl,
      credentialId ? { credentialId, userId: context.userId, workspaceAccess } : undefined
    )
    const action = credentialId ? 'reconnect' : 'connect'
    return {
      success: true,
      output: {
        message: credentialId
          ? `Reconnect authorization URL generated for ${result.serviceName}. Completing it re-authorizes credential ${credentialId} in place — its id stays the same.`
          : `Authorization URL generated for ${result.serviceName}.`,
        oauth_url: result.url,
        instructions: `Open this URL in your browser to ${action} ${result.serviceName}: ${result.url}`,
        provider: result.serviceName,
        providerId: result.providerId,
      },
    }
  } catch (err) {
    const workspaceUrl = context.workspaceId
      ? `${baseUrl}/workspace/${context.workspaceId}`
      : `${baseUrl}/workspace`
    return {
      success: false,
      error: toError(err).message,
      output: {
        message: `Could not generate a direct OAuth link for ${providerName}. Connect manually from the workspace.`,
        oauth_url: workspaceUrl,
        error: toError(err).message,
      },
    }
  }
}

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

/**
 * Resolves a human-friendly provider name to a providerId and returns a
 * browser-initiated authorize URL the user opens to connect the service.
 *
 * Steps: resolve provider → return the Sim `/api/auth/oauth2/authorize` URL.
 * That endpoint (not this server-side handler) creates the credential draft and
 * calls Better Auth, so the draft's TTL starts at click and the signed `state`
 * cookie is planted in the user's browser and the OAuth callback's state check
 * passes.
 *
 * When `reconnect` is set, the URL carries the existing credential id so the
 * authorize endpoint creates a reconnect draft and the OAuth callback rebinds
 * the credential in place instead of creating a new one. Validation happens
 * here too (not just at click time) so a bad id fails in the tool result where
 * the agent can see it, rather than as a silent browser redirect.
 */
async function generateOAuthLink(
  workspaceId: string | undefined,
  workflowId: string | undefined,
  chatId: string | undefined,
  providerName: string,
  baseUrl: string,
  reconnect?: { credentialId: string; userId: string; workspaceAccess: WorkspaceAccess }
): Promise<{ url: string; providerId: string; serviceName: string }> {
  if (!workspaceId) {
    throw new Error('workspaceId is required to generate an OAuth link')
  }

  const allServices = getAllOAuthServices()
  const normalizedInput = providerName.toLowerCase().trim()

  const matched =
    allServices.find((s) => s.providerId === normalizedInput) ||
    allServices.find((s) => s.name.toLowerCase() === normalizedInput) ||
    allServices.find(
      (s) =>
        s.name.toLowerCase().includes(normalizedInput) ||
        normalizedInput.includes(s.name.toLowerCase())
    ) ||
    allServices.find(
      (s) => s.providerId.includes(normalizedInput) || normalizedInput.includes(s.providerId)
    )

  if (!matched) {
    const available = allServices.map((s) => s.name).join(', ')
    throw new Error(`Provider "${providerName}" not found. Available providers: ${available}`)
  }

  const { providerId, name: serviceName } = matched

  if (reconnect) {
    if (providerId === 'trello' || providerId === 'shopify') {
      throw new Error(
        `Reconnect is not supported for ${serviceName} from chat. Ask the user to open the ` +
          `integrations page and press Reconnect on the credential there.`
      )
    }
    const actor = await getCredentialActorContext(reconnect.credentialId, reconnect.userId, {
      workspaceAccess: reconnect.workspaceAccess,
    })
    if (!actor.credential || actor.credential.workspaceId !== workspaceId) {
      throw new Error(
        `Credential "${reconnect.credentialId}" was not found in this workspace. Read ` +
          `environment/credentials.json for valid credential ids.`
      )
    }
    if (actor.credential.type !== 'oauth') {
      throw new Error(
        `Credential "${reconnect.credentialId}" is not an OAuth credential and cannot be reconnected.`
      )
    }
    if (actor.credential.providerId !== providerId) {
      throw new Error(
        `Credential "${reconnect.credentialId}" belongs to provider "${actor.credential.providerId}", ` +
          `not "${providerId}". Pass the matching providerName.`
      )
    }
    if (!actor.isAdmin) {
      throw new Error('Admin access on the credential is required to reconnect it.')
    }
  }

  const callbackURL =
    workflowId && workspaceId
      ? `${baseUrl}/workspace/${workspaceId}/w/${workflowId}`
      : chatId && workspaceId
        ? `${baseUrl}/workspace/${workspaceId}/chat/${chatId}`
        : `${baseUrl}/workspace/${workspaceId}`

  if (providerId === 'trello') {
    return { url: `${baseUrl}/api/auth/trello/authorize`, providerId, serviceName }
  }
  if (providerId === 'shopify') {
    const returnUrl = encodeURIComponent(callbackURL)
    return {
      url: `${baseUrl}/api/auth/shopify/authorize?returnUrl=${returnUrl}`,
      providerId,
      serviceName,
    }
  }

  // Hand back a browser-initiated authorize URL rather than calling
  // oAuth2LinkAccount here. Generating the link server-side would set Better
  // Auth's signed `state` cookie on this server-to-server response instead of the
  // user's browser, so the OAuth callback would fail with `state_mismatch`. The
  // authorize endpoint runs the link inside the user's browser, planting the
  // cookie correctly while keeping the callback's state check enabled.
  //
  // The pending credential draft is created by that authorize endpoint at click
  // time (not here), so the draft's TTL starts when the user actually initiates
  // the connect and reliably outlives the OAuth round-trip.
  const authorizeUrl = new URL(`${baseUrl}/api/auth/oauth2/authorize`)
  authorizeUrl.searchParams.set('providerId', providerId)
  authorizeUrl.searchParams.set('workspaceId', workspaceId)
  authorizeUrl.searchParams.set('callbackURL', callbackURL)
  if (reconnect) {
    authorizeUrl.searchParams.set('credentialId', reconnect.credentialId)
  }

  return { url: authorizeUrl.toString(), providerId, serviceName }
}
