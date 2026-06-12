import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { isAuthDisabled } from '@/lib/core/config/feature-flags'
import { enforceIpRateLimit } from '@/lib/core/rate-limiter'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('SocketTokenAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  if (isAuthDisabled) {
    return NextResponse.json({ token: 'anonymous-socket-token' })
  }

  const rateLimited = await enforceIpRateLimit('socket-token', request, {
    maxTokens: 30,
    refillRate: 30,
    refillIntervalMs: 60_000,
  })
  if (rateLimited) return rateLimited

  try {
    const hdrs = await headers()
    const response = await auth.api.generateOneTimeToken({
      headers: hdrs,
    })

    if (!response?.token) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    return NextResponse.json({ token: response.token })
  } catch (error) {
    // better-auth's sessionMiddleware throws APIError("UNAUTHORIZED") with no message
    // when the session is missing/expired — surface this as a 401, not a 500.
    if (
      error instanceof Error &&
      ('statusCode' in error || 'status' in error) &&
      ((error as Record<string, unknown>).statusCode === 401 ||
        (error as Record<string, unknown>).status === 'UNAUTHORIZED')
    ) {
      logger.warn('Socket token request with invalid/expired session')
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    logger.error('Failed to generate socket token', {
      error: toError(error).message,
      stack: error instanceof Error ? error.stack : undefined,
    })
    return NextResponse.json({ error: 'Failed to generate token' }, { status: 500 })
  }
})
