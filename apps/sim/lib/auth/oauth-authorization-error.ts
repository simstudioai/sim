import { isIP } from 'node:net'
import { db } from '@sim/db'
import { oauthClient } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { oauthErrorResponse } from '@/lib/auth/oauth-protocol-request'
import { getBaseUrl } from '@/lib/core/utils/urls'

const logger = createLogger('OAuthAuthorizationError')

export type OAuthAuthorizationErrorCode =
  | 'access_denied'
  | 'invalid_request'
  | 'unsupported_response_type'

function isLoopbackIp(hostname: string): boolean {
  const address = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname
  return (isIP(address) === 4 && address.startsWith('127.')) || address === '::1'
}

/** Matches Better Auth's exact redirect rule, including RFC 8252 loopback port variance. */
export function oauthRedirectUriMatches(registeredUri: string, requestedUri: string): boolean {
  if (registeredUri === requestedUri) return true

  try {
    const registered = new URL(registeredUri)
    const requested = new URL(requestedUri)
    return (
      isLoopbackIp(registered.hostname) &&
      registered.hostname === requested.hostname &&
      registered.protocol === requested.protocol &&
      registered.pathname === requested.pathname &&
      registered.search === requested.search
    )
  } catch {
    return false
  }
}

/**
 * Redirects an authorization error only after proving the callback belongs to
 * the single registered, enabled client named by the request.
 */
export async function oauthAuthorizationErrorResponse(
  request: NextRequest,
  error: OAuthAuthorizationErrorCode,
  description: string
): Promise<NextResponse> {
  const params = request.nextUrl.searchParams
  const clientIds = params.getAll('client_id')
  const redirectUris = params.getAll('redirect_uri')
  if (clientIds.length !== 1 || redirectUris.length !== 1) {
    return oauthErrorResponse(error, description)
  }

  const clientId = clientIds[0]
  const redirectUri = redirectUris[0]
  let client: { disabled: boolean; redirectUris: string[] } | undefined
  let issuer: string
  try {
    const clients = await db
      .select({ disabled: oauthClient.disabled, redirectUris: oauthClient.redirectUris })
      .from(oauthClient)
      .where(eq(oauthClient.clientId, clientId))
      .limit(1)
    client = clients[0]
    issuer = `${getBaseUrl()}/api/auth`
  } catch (caught) {
    logger.error('Failed to validate an OAuth authorization error redirect', {
      error: toError(caught),
    })
    return oauthErrorResponse('server_error', 'Authorization request failed.', 500)
  }

  if (
    !client ||
    client.disabled ||
    !client.redirectUris.some((registered) => oauthRedirectUriMatches(registered, redirectUri))
  ) {
    return oauthErrorResponse(error, description)
  }

  const location = new URL(redirectUri)
  location.searchParams.set('error', error)
  location.searchParams.set('error_description', description)
  const states = params.getAll('state')
  if (states.length === 1) location.searchParams.set('state', states[0])
  location.searchParams.set('iss', issuer)
  return NextResponse.redirect(location, {
    status: 302,
    headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
  })
}
