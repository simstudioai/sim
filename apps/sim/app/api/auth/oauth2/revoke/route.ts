import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import {
  oauthErrorResponse,
  oauthProtocolErrorResponse,
  oauthRevocationSuccessResponse,
  parseOAuthFormRequest,
} from '@/lib/auth/oauth-protocol-request'
import { revokeOAuthToken } from '@/lib/auth/oauth-token-family'
import { isAuthDisabled } from '@/lib/core/config/env-flags'
import { enforceIpRateLimit, type TokenBucketConfig } from '@/lib/core/rate-limiter'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('OAuthRevocationEndpoint')

const REVOKE_RATE_LIMIT: TokenBucketConfig = {
  maxTokens: 30,
  refillRate: 30,
  refillIntervalMs: 60_000,
}

/** Revokes one opaque access token or the complete family named by a refresh token. */
export const POST = withRouteHandler(async (request: NextRequest) => {
  if (isAuthDisabled) {
    return NextResponse.json(
      { error: 'OAuth provider is not enabled' },
      { status: 404, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } }
    )
  }

  try {
    const rateLimited = await enforceIpRateLimit(
      'oauth-provider-revoke',
      request,
      REVOKE_RATE_LIMIT
    )
    if (rateLimited) {
      rateLimited.headers.set('Cache-Control', 'no-store')
      rateLimited.headers.set('Pragma', 'no-cache')
      return rateLimited
    }
    const parsed = await parseOAuthFormRequest(request)
    if (!parsed.success) return parsed.response

    if (!parsed.value.credentials) {
      return oauthErrorResponse('invalid_client', 'Client authentication is required.')
    }
    const token = parsed.value.form.get('token')
    if (!token) return oauthErrorResponse('invalid_request', 'Token is required.')

    const result = await revokeOAuthToken({ credentials: parsed.value.credentials, token })
    if (!result.success) {
      return oauthProtocolErrorResponse(
        result.error,
        result.description,
        parsed.value.credentials.method
      )
    }
    return oauthRevocationSuccessResponse()
  } catch (error) {
    logger.error('OAuth revocation endpoint failed', { error: toError(error) })
    return oauthErrorResponse('server_error', 'Revocation endpoint failed.', 500)
  }
})
