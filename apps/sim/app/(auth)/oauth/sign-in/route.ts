import { type NextRequest, NextResponse } from 'next/server'
import { isAuthDisabled, isRegistrationDisabled } from '@/lib/core/config/env-flags'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'

/**
 * Query parameters the OAuth plugin adds when it signs the authorize query for
 * a `loginPage` redirect. Re-entering authorize starts a fresh request, which
 * signs its own, so carrying the old ones forward would only widen the URL.
 */
const SIGNED_QUERY_PARAMS = new Set(['sig', 'exp', 'ba_iat', 'ba_param', 'ba_pl'])

/** Removes prompts completed by the login/signup hop while preserving later consent prompts. */
function consumeInteractivePrompt(params: URLSearchParams): boolean {
  const prompts = (params.get('prompt') ?? '').split(/\s+/).filter(Boolean)
  const requiresLogin = prompts.includes('login')
  const remaining = prompts.filter((prompt) => prompt !== 'login' && prompt !== 'create')
  if (remaining.length > 0) params.set('prompt', remaining.join(' '))
  else params.delete('prompt')
  return requiresLogin
}

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
  /** Avoid sending a newly signed-in user to a disabled provider's JSON 404. */
  if (isAuthDisabled) {
    return NextResponse.redirect(new URL('/', getBaseUrl()), 302)
  }

  const params = new URLSearchParams(request.nextUrl.search)
  for (const name of SIGNED_QUERY_PARAMS) params.delete(name)
  const requiresLogin = consumeInteractivePrompt(params)

  const authorizeUrl = `/api/auth/oauth2/authorize?${params.toString()}`
  const destination = buildAuthCrossLink(
    isRegistrationDisabled || requiresLogin ? '/login' : '/signup',
    {
      callbackUrl: authorizeUrl,
      isInviteFlow: false,
    }
  )

  /** Use the auth server's origin: Next normalizes loopback hosts and proxy ingress may differ. */
  return NextResponse.redirect(new URL(destination, getBaseUrl()), 302)
})
