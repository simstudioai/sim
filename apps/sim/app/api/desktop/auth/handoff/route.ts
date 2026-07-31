import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { createDesktopHandoffToken } from '@/lib/auth/desktop-handoff'
import { enforceIpRateLimit } from '@/lib/core/rate-limiter'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('DesktopHandoffAPI')

/**
 * Mints the one-time token that signs the desktop app in, on a session of its
 * own rather than the browser's (see `createDesktopHandoffToken`). Called from
 * the `/desktop/auth` confirm gesture — a bare GET must never mint one, because
 * the loopback port is attacker-choosable in a crafted link and whoever holds
 * that port receives a redeemable session.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  // Every mint creates a session row, so this is deliberately below the default
  // public route allowance: a handoff is one human click, and a legitimate
  // caller retrying a failed sign-in needs only a handful per minute.
  const rateLimited = await enforceIpRateLimit('desktop-auth-handoff', request, {
    maxTokens: 5,
    refillRate: 5,
    refillIntervalMs: 60_000,
  })
  if (rateLimited) return rateLimited

  const hdrs = await headers()
  // Force a database-backed read. A cookie-cached session can outlive its row
  // after a sign-out or revoke, and minting against one would hand the desktop
  // a token that can never be redeemed.
  const session = await auth.api.getSession({
    headers: hdrs,
    query: { disableCookieCache: true },
  })
  if (!session?.user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  try {
    const token = await createDesktopHandoffToken(session.user.id)
    return NextResponse.json({ token })
  } catch (error) {
    // Session creation runs the app's own `session.create.before` hook, which
    // rejects access-controlled accounts with a Better Auth APIError. That is a
    // permanent refusal, not a server fault — a 500 would tell the user to try
    // again forever.
    if (
      error instanceof Error &&
      'statusCode' in error &&
      (error as Record<string, unknown>).statusCode === 403
    ) {
      logger.warn('Desktop handoff refused for this account', { userId: session.user.id })
      return NextResponse.json(
        { error: getErrorMessage(error, 'Access restricted') },
        { status: 403 }
      )
    }
    throw error
  }
})
