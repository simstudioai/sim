import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { toNextJsHandler } from 'better-auth/next-js'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import {
  buildDelegatedOAuthRequest,
  isValidOAuthCodeVerifier,
  missingOAuthParameterResponse,
  normalizeDelegatedOAuthTokenResponse,
  oauthErrorResponse,
  oauthProtocolErrorResponse,
  parseOAuthFormRequest,
  parseRequestedScopes,
  unsupportedGrantResponse,
} from '@/lib/auth/oauth-protocol-request'
import { withOAuthProviderIssuanceCompensation } from '@/lib/auth/oauth-provider-adapter-guard'
import {
  rotateOAuthRefreshToken,
  validateOAuthClientCredentials,
} from '@/lib/auth/oauth-token-family'
import { isAuthDisabled } from '@/lib/core/config/env-flags'
import { enforceIpRateLimit, type TokenBucketConfig } from '@/lib/core/rate-limiter'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('OAuthTokenEndpoint')
const { POST: betterAuthPOST } = toNextJsHandler(auth.handler)

const TOKEN_RATE_LIMIT: TokenBucketConfig = {
  maxTokens: 20,
  refillRate: 20,
  refillIntervalMs: 60_000,
}

/**
 * Delegates authorization-code exchange to Better Auth and owns refresh
 * rotation, whose per-login replay containment requires one PostgreSQL
 * transaction that the provider does not expose as a configuration hook.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  if (isAuthDisabled) {
    return NextResponse.json(
      { error: 'OAuth provider is not enabled' },
      { status: 404, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } }
    )
  }

  try {
    const rateLimited = await enforceIpRateLimit('oauth-provider-token', request, TOKEN_RATE_LIMIT)
    if (rateLimited) {
      rateLimited.headers.set('Cache-Control', 'no-store')
      rateLimited.headers.set('Pragma', 'no-cache')
      return rateLimited
    }
    const parsed = await parseOAuthFormRequest(request)
    if (!parsed.success) return parsed.response
    const grantType = parsed.value.form.get('grant_type')
    if (!grantType) return missingOAuthParameterResponse('grant_type')
    if (grantType !== 'authorization_code' && grantType !== 'refresh_token') {
      return unsupportedGrantResponse(grantType)
    }
    if (parsed.value.form.has('resource')) {
      return oauthErrorResponse('invalid_request', 'The resource parameter is not supported.')
    }
    if (grantType === 'authorization_code') {
      const codeVerifier = parsed.value.form.get('code_verifier')
      if (codeVerifier !== null && !isValidOAuthCodeVerifier(codeVerifier)) {
        return oauthErrorResponse('invalid_grant', 'Code verifier is invalid.')
      }
      if (!parsed.value.credentials) {
        return oauthErrorResponse('invalid_client', 'Client authentication is required.')
      }
      const authenticated = await validateOAuthClientCredentials(parsed.value.credentials)
      if (!authenticated.success) {
        return oauthProtocolErrorResponse(
          authenticated.error,
          authenticated.description,
          parsed.value.credentials.method
        )
      }
      const response = await withOAuthProviderIssuanceCompensation(() =>
        betterAuthPOST(buildDelegatedOAuthRequest(request, parsed.value))
      )
      return normalizeDelegatedOAuthTokenResponse(response, parsed.value.credentials.method)
    }

    if (!parsed.value.credentials) {
      return oauthErrorResponse('invalid_client', 'Client authentication is required.')
    }
    const refreshToken = parsed.value.form.get('refresh_token')
    if (!refreshToken) return missingOAuthParameterResponse('refresh_token')

    const result = await rotateOAuthRefreshToken({
      credentials: parsed.value.credentials,
      refreshToken,
      requestedScopes: parseRequestedScopes(parsed.value.form),
    })
    if (!result.success) {
      return oauthProtocolErrorResponse(
        result.error,
        result.description,
        parsed.value.credentials.method
      )
    }

    return NextResponse.json(
      {
        access_token: result.value.accessToken,
        expires_in: result.value.expiresIn,
        expires_at: result.value.expiresAt,
        token_type: 'Bearer',
        refresh_token: result.value.refreshToken,
        scope: result.value.scope,
      },
      { headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } }
    )
  } catch (error) {
    logger.error('OAuth token endpoint failed', { error: toError(error) })
    return oauthErrorResponse('server_error', 'Token endpoint failed.', 500)
  }
})
