import { createLogger } from '@sim/logger'
import { toNextJsHandler } from 'better-auth/next-js'
import { type NextRequest, NextResponse } from 'next/server'
import { authorizeOAuth2Contract } from '@/lib/api/contracts/oauth-connections'
import { parseRequest } from '@/lib/api/server'
import { auth, getSession } from '@/lib/auth/auth'
import { oauthAuthorizationErrorResponse } from '@/lib/auth/oauth-authorization-error'
import { validateOAuthPkceAuthorizationRequest } from '@/lib/auth/oauth-protocol-request'
import { isOAuthProviderEnabled } from '@/lib/auth/oauth-provider-feature'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import { requireConfiguredOAuthClient } from '@/lib/core/config/env-capabilities.server'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { isSameOrigin } from '@/lib/core/utils/validation'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { CredentialConnectionProviderMismatchError } from '@/lib/credentials/application/connection-target'
import { createCredentialConnection } from '@/lib/credentials/application/create-credential-connection'
import { launchCredentialConnection } from '@/lib/credentials/application/launch-credential-connection'
import { OAUTH_CREDENTIAL_DRAFT_CALLBACK_PARAM } from '@/lib/credentials/draft-constants'
import { decryptQuickBooksOAuthClientConfig } from '@/lib/oauth/quickbooks-client-config'
import { QUICKBOOKS_AUTHORIZATION_URL } from '@/lib/oauth/quickbooks-constants'
import { createQuickBooksOAuthState } from '@/lib/oauth/quickbooks-state'
import { getCanonicalScopesForProvider, getPerRequestOAuthLinkScopes } from '@/lib/oauth/utils'

const logger = createLogger('OAuth2Authorize')

export const dynamic = 'force-dynamic'

const { GET: betterAuthGET } = toNextJsHandler(auth.handler)

const OAUTH_AUTHORIZE_PARAMETERS = new Set([
  'response_type',
  'client_id',
  'redirect_uri',
  'scope',
  'state',
  'request_uri',
  'code_challenge',
  'code_challenge_method',
  'nonce',
  'prompt',
  'resource',
])

/** Returns the first ambiguous OAuth authorization parameter. */
function repeatedOAuthAuthorizeParameter(request: NextRequest): string | null {
  for (const name of OAUTH_AUTHORIZE_PARAMETERS) {
    if (request.nextUrl.searchParams.getAll(name).length <= 1) continue
    return name
  }
  return null
}

/**
 * Whether this is a client asking Sim to sign its user in — the OAuth provider's
 * authorize request — rather than a user linking an external account.
 *
 * This route sits on the same path Better Auth mounts the provider's authorize
 * endpoint, so the catch-all never sees it. Connector links use only the
 * contract's draft/provider/workspace fields; any provider-specific parameter
 * keeps even a malformed OAuth request out of the credential-linking flow.
 */
function isOAuthProviderAuthorize(request: NextRequest): boolean {
  for (const name of OAUTH_AUTHORIZE_PARAMETERS) {
    if (request.nextUrl.searchParams.has(name)) return true
  }
  return false
}

/**
 * Browser-initiated entrypoint for linking a generic OAuth2 account, and the
 * OAuth provider's authorize endpoint when the request is a client's.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  if (isOAuthProviderAuthorize(request)) {
    if (!(await isOAuthProviderEnabled())) {
      return NextResponse.json(
        { error: 'OAuth provider is not enabled' },
        { status: 404, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } }
      )
    }
    const repeatedParameter = repeatedOAuthAuthorizeParameter(request)
    if (repeatedParameter) {
      return oauthAuthorizationErrorResponse(
        request,
        'invalid_request',
        `OAuth parameter ${repeatedParameter} appears more than once.`
      )
    }
    const params = request.nextUrl.searchParams
    if (!params.has('client_id')) {
      return oauthAuthorizationErrorResponse(
        request,
        'invalid_request',
        'The client_id parameter is required.'
      )
    }
    if (!params.has('redirect_uri')) {
      return oauthAuthorizationErrorResponse(
        request,
        'invalid_request',
        'The redirect_uri parameter is required.'
      )
    }
    if (params.has('resource')) {
      return oauthAuthorizationErrorResponse(
        request,
        'invalid_request',
        'The resource parameter is not supported.'
      )
    }
    if (params.has('request_uri')) {
      return oauthAuthorizationErrorResponse(
        request,
        'invalid_request',
        'The request_uri parameter is not supported.'
      )
    }
    const responseType = params.get('response_type')
    if (!responseType) {
      return oauthAuthorizationErrorResponse(
        request,
        'invalid_request',
        'The response_type parameter is required.'
      )
    }
    if (responseType !== 'code') {
      return oauthAuthorizationErrorResponse(
        request,
        'unsupported_response_type',
        'Only the code response type is supported.'
      )
    }
    const pkceError = validateOAuthPkceAuthorizationRequest(params)
    if (pkceError) {
      return oauthAuthorizationErrorResponse(request, 'invalid_request', pkceError)
    }
    return betterAuthGET(request)
  }

  const baseUrl = getBaseUrl()

  const session = await getSession()
  if (!session?.user?.id) {
    const loginUrl = new URL('/login', baseUrl)
    loginUrl.searchParams.set('callbackUrl', request.nextUrl.pathname + request.nextUrl.search)
    return NextResponse.redirect(loginUrl.toString())
  }
  const userId = session.user.id
  const sessionId = session.session?.id
  if (!sessionId) throw new Error('Authenticated session is missing its session ID')
  const principal = { kind: 'session' as const, userId, sessionId }

  const parsed = await parseRequest(authorizeOAuth2Contract, request, {})
  if (!parsed.success) return parsed.response
  const { draftId } = parsed.data.query
  let { providerId, workspaceId, callbackURL: requestedCallback, credentialId } = parsed.data.query

  try {
    let fromConnectionDraft = false
    let connectionDraftId: string | undefined
    let encryptedQuickBooksClientConfig: string | null | undefined
    if (draftId) {
      try {
        const { draft } = await launchCredentialConnection.execute({
          principal,
          input: { draftId },
          request,
        })
        providerId = draft.providerId
        workspaceId = draft.workspaceId
        credentialId = draft.credentialId ?? undefined
        connectionDraftId = draft.id
        encryptedQuickBooksClientConfig = draft.oauthConfig
        fromConnectionDraft = true
      } catch (error) {
        if (!(error instanceof OrchestrationError)) throw error
        logger.warn('Rejected OAuth connection draft', { userId, draftId, code: error.code })
        return NextResponse.redirect(`${baseUrl}/workspace?error=oauth_link_invalid`)
      }
    }

    if (!providerId || !workspaceId) {
      throw new Error('Validated OAuth authorization request is missing its target')
    }
    if (providerId !== 'quickbooks') {
      requireConfiguredOAuthClient(providerId)
    }

    const connectionCompleteUrl = new URL('/oauth/credential-connected', baseUrl)
    connectionCompleteUrl.searchParams.set('result', 'connected')
    const callbackURL = fromConnectionDraft
      ? requestedCallback && isSameOrigin(requestedCallback)
        ? requestedCallback
        : connectionCompleteUrl.toString()
      : requestedCallback?.startsWith(`${baseUrl}/`)
        ? requestedCallback
        : `${baseUrl}/workspace`

    if (!fromConnectionDraft) {
      try {
        const connection = await createCredentialConnection.execute({
          principal,
          input: credentialId
            ? { workspaceId, credentialId, assertedProviderId: providerId }
            : { workspaceId, providerId },
          request,
        })
        providerId = connection.providerId
        workspaceId = connection.workspaceId
        credentialId = connection.credentialId
        connectionDraftId = connection.draftId
      } catch (error) {
        if (error instanceof CredentialConnectionProviderMismatchError) {
          return NextResponse.redirect(`${baseUrl}/workspace?error=credential_provider_mismatch`)
        }
        if (
          credentialId &&
          error instanceof ForbiddenOperationError &&
          error.detailCode === 'CREDENTIAL_ADMIN_ACCESS_REQUIRED'
        ) {
          return NextResponse.redirect(`${baseUrl}/workspace?error=credential_access_denied`)
        }
        if (error instanceof OrchestrationError && error.code === 'not_found') {
          return NextResponse.redirect(
            `${baseUrl}/workspace?error=${credentialId ? 'credential_access_denied' : 'workspace_access_denied'}`
          )
        }
        if (error instanceof OrchestrationError && error.code === 'forbidden') {
          return NextResponse.redirect(`${baseUrl}/workspace?error=workspace_access_denied`)
        }
        throw error
      }
    }

    if (!connectionDraftId) {
      throw new Error('OAuth authorization is missing its credential draft id')
    }

    if (providerId === 'quickbooks') {
      if (!encryptedQuickBooksClientConfig) {
        const { draft } = await launchCredentialConnection.execute({
          principal,
          input: { draftId: connectionDraftId },
          request,
        })
        encryptedQuickBooksClientConfig = draft.oauthConfig
      }
      if (!encryptedQuickBooksClientConfig) {
        throw new Error('QuickBooks OAuth client configuration is missing')
      }
      const clientConfig = await decryptQuickBooksOAuthClientConfig(encryptedQuickBooksClientConfig)
      const redirectUri = `${baseUrl}/api/auth/oauth2/callback/quickbooks`
      const state = createQuickBooksOAuthState({
        userId,
        draftId: connectionDraftId,
        returnUrl: callbackURL,
      })
      const authorizeUrl = new URL(QUICKBOOKS_AUTHORIZATION_URL)
      authorizeUrl.searchParams.set('client_id', clientConfig.clientId)
      authorizeUrl.searchParams.set('response_type', 'code')
      authorizeUrl.searchParams.set('scope', getCanonicalScopesForProvider(providerId).join(' '))
      authorizeUrl.searchParams.set('redirect_uri', redirectUri)
      authorizeUrl.searchParams.set('state', state)
      return NextResponse.redirect(authorizeUrl)
    }

    if (providerId === 'trello' || providerId === 'instagram' || providerId === 'shopify') {
      const authorizeUrl = new URL(`/api/auth/${providerId}/authorize`, baseUrl)
      authorizeUrl.searchParams.set('returnUrl', callbackURL)
      authorizeUrl.searchParams.set('draftId', connectionDraftId)
      return NextResponse.redirect(authorizeUrl)
    }

    const stateCallbackUrl = new URL(callbackURL)
    stateCallbackUrl.searchParams.set(OAUTH_CREDENTIAL_DRAFT_CALLBACK_PARAM, connectionDraftId)
    const scopes = getPerRequestOAuthLinkScopes(providerId)

    const linkResponse = await auth.api.oAuth2LinkAccount({
      body: {
        providerId,
        callbackURL: stateCallbackUrl.toString(),
        ...(scopes && { scopes }),
        ...(fromConnectionDraft
          ? { errorCallbackURL: `${baseUrl}/oauth/credential-connected?result=failed` }
          : {}),
      },
      headers: request.headers,
      asResponse: true,
    })

    const payload = (await linkResponse.json().catch(() => null)) as { url?: string } | null
    if (!linkResponse.ok || !payload?.url) {
      logger.error('oAuth2LinkAccount did not return an authorization URL', {
        providerId,
        status: linkResponse.status,
      })
      return NextResponse.redirect(`${baseUrl}/workspace?error=oauth_link_failed`)
    }

    const response = NextResponse.redirect(payload.url)
    // Forward the signed `state` cookie Better Auth set so it lands in the user's
    // browser and is present when the provider redirects back to the callback.
    const linkHeaders = linkResponse.headers as Headers & {
      getSetCookie?: () => string[]
    }
    for (const cookie of linkHeaders.getSetCookie?.() ?? []) {
      response.headers.append('set-cookie', cookie)
    }
    return response
  } catch (error) {
    logger.error('Failed to initiate OAuth2 authorization', { providerId, error })
    return NextResponse.redirect(`${baseUrl}/workspace?error=oauth_link_failed`)
  }
})
