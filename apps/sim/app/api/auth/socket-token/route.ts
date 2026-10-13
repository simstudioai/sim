import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { auth, getSession } from '@/lib/auth'
import { getBetterAuthClientErrorStatus } from '@/lib/auth/better-auth-error'
import { isAuthDisabled } from '@/lib/core/config/env-flags'
import {
  enforceIpRateLimit,
  enforceUserRateLimit,
  type TokenBucketConfig,
} from '@/lib/core/rate-limiter'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('SocketTokenAPI')

/**
 * The real budget. A tab mints one token per document load and per socket
 * reconnect, so a user's burst is roughly their open tabs reconnecting at once
 * after a deploy; 30 covers that, and a steady 30/min is far above any
 * legitimate reload rate while still bounding the token rows one account can
 * create.
 */
const USER_LIMIT: TokenBucketConfig = {
  maxTokens: 30,
  refillRate: 30,
  refillIntervalMs: 60_000,
}

/**
 * A backstop, not the budget: an office or carrier NAT puts many users on one
 * address, and keying the budget on IP would let them throttle each other. Ten
 * users' worth of burst keeps a NAT'd team reconnecting after a deploy under
 * it while still capping what one address can push at the session lookup.
 */
const IP_BACKSTOP_LIMIT: TokenBucketConfig = {
  maxTokens: 300,
  refillRate: 300,
  refillIntervalMs: 60_000,
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  if (isAuthDisabled) {
    return NextResponse.json({ token: 'anonymous-socket-token' })
  }

  const ipLimited = await enforceIpRateLimit('socket-token-ip', request, IP_BACKSTOP_LIMIT)
  if (ipLimited) return ipLimited

  try {
    // A cookie-cached read, used only to key the bucket; the mint re-reads the database.
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const userLimited = await enforceUserRateLimit('socket-token', session.user.id, USER_LIMIT)
    if (userLimited) return userLimited

    const hdrs = await headers()
    // Force a DB-backed session read. With the cookie cache enabled, the
    // session middleware can mint a token off a cached session whose row is
    // already gone (the window right after a sign-out), which succeeds here
    // and then fails in the realtime server with "Session not found" — the
    // socket retries that forever. A fresh read turns that into a clean 401
    // the client can re-authenticate from.
    const response = await auth.api.generateOneTimeToken({
      headers: hdrs,
      query: { disableCookieCache: true },
    })

    if (!response?.token) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    return NextResponse.json({ token: response.token })
  } catch (error) {
    /**
     * better-auth's sessionMiddleware throws `APIError("UNAUTHORIZED")` with no message when the
     * session is missing or expired — surface that as a 401, not a 500.
     */
    if (getBetterAuthClientErrorStatus(error) === 401) {
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
