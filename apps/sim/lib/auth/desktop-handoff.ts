import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import { auth } from '@/lib/auth'

const logger = createLogger('DesktopHandoff')

/**
 * Identifier namespace Better Auth's one-time-token plugin reads in
 * `/one-time-token/verify`. The row is written here rather than through
 * `generateOneTimeToken` so the token resolves to a session minted for the
 * desktop app — see {@link createDesktopHandoffToken}. This constant is the
 * only coupling to the plugin's storage layout, and it holds because the
 * plugin's `storeToken` option is left at its `'plain'` default, so the token
 * is stored verbatim rather than hashed.
 */
const ONE_TIME_TOKEN_IDENTIFIER_PREFIX = 'one-time-token:'

/** Matches the token length Better Auth generates for its own one-time tokens. */
const HANDOFF_TOKEN_LENGTH = 32

/**
 * The browser navigates straight to the desktop app's loopback listener once
 * the token is minted, so a redeem lands within seconds. Deliberately far
 * shorter than the plugin-wide 24h `expiresIn`: this token is a bearer
 * credential that grants a session, and `/one-time-token/verify` enforces the
 * expiry stored on the row, not the plugin option.
 */
const HANDOFF_TOKEN_TTL_MS = 3 * 60 * 1000

/**
 * Recorded as the session's user agent. The row is created while handling the
 * *browser's* request, so the real user agent would misattribute the desktop's
 * session to the browser in session listings and audit trails.
 */
const DESKTOP_SESSION_USER_AGENT = 'Sim Desktop'

/**
 * Mints a one-time token that signs the desktop app in as `userId` on a session
 * of its own.
 *
 * Better Auth's `generateOneTimeToken` binds the token to the *calling* session
 * row, and `/one-time-token/verify` then hands that same row's cookie to
 * whoever redeems it. Used as-is, the desktop app and the browser that
 * authorized it share a single session: signing out of either deletes the row
 * the other is still presenting, leaving that client holding a cookie for a
 * session that no longer exists — and, because the session cookie cache is not
 * revalidated against the database, still looking signed in until the cache
 * expires. Every request it authorizes off that cache then fails anywhere the
 * session is resolved from the database, notably socket handshakes.
 *
 * A session per device is what Better Auth's own device authorization grant
 * does, and what RFC 8252 assumes of a native app: sign-out, revocation, and
 * expiry apply to one surface at a time.
 */
export async function createDesktopHandoffToken(userId: string): Promise<string> {
  const ctx = await auth.$context
  const desktopSession = await ctx.internalAdapter.createSession(userId, false, {
    userAgent: DESKTOP_SESSION_USER_AGENT,
  })

  const token = generateShortId(HANDOFF_TOKEN_LENGTH)
  await ctx.internalAdapter.createVerificationValue({
    value: desktopSession.token,
    identifier: `${ONE_TIME_TOKEN_IDENTIFIER_PREFIX}${token}`,
    expiresAt: new Date(Date.now() + HANDOFF_TOKEN_TTL_MS),
  })

  logger.info('Minted desktop handoff token', { userId, sessionId: desktopSession.id })
  return token
}
