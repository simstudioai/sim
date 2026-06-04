import { toError } from '@sim/utils/errors'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { ensureWorkspaceAccess } from '@/lib/copilot/tools/handlers/access'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { getAllOAuthServices } from '@/lib/oauth/utils'

export async function executeOAuthGetAuthLink(
  rawParams: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const providerName = String(rawParams.providerName || rawParams.provider_name || '')
  const baseUrl = getBaseUrl()
  try {
    if (!context.workspaceId || !context.userId) {
      throw new Error('workspaceId and userId are required to generate an OAuth link')
    }
    await ensureWorkspaceAccess(context.workspaceId, context.userId, 'write')
    const result = await generateOAuthLink(
      context.workspaceId,
      context.workflowId,
      context.chatId,
      providerName,
      baseUrl
    )
    return {
      success: true,
      output: {
        message: `Authorization URL generated for ${result.serviceName}.`,
        oauth_url: result.url,
        instructions: `Open this URL in your browser to connect ${result.serviceName}: ${result.url}`,
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
 */
async function generateOAuthLink(
  workspaceId: string | undefined,
  workflowId: string | undefined,
  chatId: string | undefined,
  providerName: string,
  baseUrl: string
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
  const callbackURL =
    workflowId && workspaceId
      ? `${baseUrl}/workspace/${workspaceId}/w/${workflowId}`
      : chatId && workspaceId
        ? `${baseUrl}/workspace/${workspaceId}/task/${chatId}`
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

  return { url: authorizeUrl.toString(), providerId, serviceName }
}
