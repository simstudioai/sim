import { type NextRequest, NextResponse } from 'next/server'
import { isOAuthProviderEnabled, isRegistrationDisabled } from '@/lib/core/config/env-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'

/**
 * Query parameters the OAuth plugin adds when it signs the authorize query for
 * a `loginPage` redirect. Re-entering authorize starts a fresh request, which
 * signs its own, so carrying the old ones forward would only widen the URL.
 */
const SIGNED_QUERY_PARAMS = new Set(['sig', 'exp', 'ba_iat', 'ba_param', 'ba_pl'])

/**
 * The OAuth provider's `loginPage`: where a signed-out user lands when a client
 * starts `/api/auth/oauth2/authorize`.
 *
 * The plugin forwards the whole authorize query, signed. The authorize endpoint
 * is stateless, so the flow resumes by simply visiting it again once a session
 * exists. This route rebuilds that URL from the original parameters and hands
 * it to the normal auth pages as `callbackUrl`, which is how every other
 * post-login destination in Sim travels — no second login form, no plugin
 * client hooks to keep in step.
 *
 * Signup rather than login by default, for the same reason the CLI handoff
 * chooses it: this is reached from a terminal, often on a fresh install. Under
 * DISABLE_REGISTRATION nobody can create an account, so login is the only hop
 * that can succeed.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  // Gated like the consent page: with the provider off, the authorize URL this
  // builds is a JSON 404, so bouncing someone through signup to reach it would
  // land them on a raw error body having just created an account.
  if (!isOAuthProviderEnabled) {
    return NextResponse.redirect(new URL('/', request.nextUrl.origin), 302)
  }

  const params = new URLSearchParams(request.nextUrl.search)
  for (const name of SIGNED_QUERY_PARAMS) params.delete(name)

  const authorizeUrl = `/api/auth/oauth2/authorize?${params.toString()}`
  const destination = buildAuthCrossLink(isRegistrationDisabled ? '/login' : '/signup', {
    callbackUrl: authorizeUrl,
    isInviteFlow: false,
  })

  return NextResponse.redirect(new URL(destination, request.nextUrl.origin), 302)
})
