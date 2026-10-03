import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { auth, getSession } from '@/lib/auth'
import { isIdpInitiatedLoginAllowed } from '@/lib/auth/sso/idp-initiated-login'
import { isSsoEnabled } from '@/lib/core/config/env-flags'
import { enforceIpRateLimit } from '@/lib/core/rate-limiter'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { DEFAULT_POST_AUTH_ROUTE } from '@/app/(auth)/auth-redirect'

const logger = createLogger('SSOLaunchRoute')

type RouteContext = { params: Promise<{ providerId: string }> }

/**
 * The initiate login URL an identity provider's app dashboard opens (OpenID Connect third-party
 * initiated login). The dashboard adds its issuer as `iss`, so the URL carries no query of its own.
 *
 * Sign-in starts here rather than on the sign-in page: the visitor arrives to be sent onward, and a
 * redirect spares them a page load and a hydration wait first. Someone already signed in goes
 * straight to the app, so a link cannot replace their session. Anything else — an unknown issuer, a
 * provider this deployment does not serve, a refused sign-in — falls back to the provider's ordinary
 * sign-in link, which asks for an email.
 */
export const GET = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const { providerId } = await context.params
  const signInLink = new URL(
    `/sso?provider=${encodeURIComponent(providerId)}`,
    getBaseUrl()
  ).toString()
  if (!isSsoEnabled) return NextResponse.redirect(new URL('/login', getBaseUrl()).toString())

  const session = await getSession()
  if (session?.user) {
    return NextResponse.redirect(new URL(DEFAULT_POST_AUTH_ROUTE, getBaseUrl()).toString())
  }

  /** Admitted per address, after the session, so a busy shared address never strands a signed-in visitor. */
  const rateLimited = await enforceIpRateLimit('sso-launch', request, {
    maxTokens: 30,
    refillRate: 30,
    refillIntervalMs: 60_000,
  })
  if (rateLimited) return NextResponse.redirect(signInLink)

  const issuer = request.nextUrl.searchParams.get('iss')
  if (!issuer || !(await isIdpInitiatedLoginAllowed(providerId, issuer))) {
    return NextResponse.redirect(signInLink)
  }

  /**
   * A failed sign-in returns to the provider's sign-in link with the error. `callbackUrl` comes
   * last because the SSO plugin appends its own error with a raw `?`, which runs into whichever
   * parameter is last — there it is harmless, on `provider` it would corrupt the retry.
   */
  const errorCallbackURL = new URL(
    `/sso?error=sso_failed&provider=${encodeURIComponent(providerId)}&callbackUrl=${encodeURIComponent(DEFAULT_POST_AUTH_ROUTE)}`,
    getBaseUrl()
  ).toString()
  /** A sign-in that never starts is a failure, so it carries the error rather than a blank form. */
  let signIn: Response
  try {
    signIn = await auth.api.signInSSO({
      body: { providerId, callbackURL: DEFAULT_POST_AUTH_ROUTE, errorCallbackURL },
      headers: request.headers,
      asResponse: true,
    })
  } catch (error) {
    logger.error('SSO sign-in could not be started', { providerId, error: toError(error) })
    return NextResponse.redirect(errorCallbackURL)
  }
  const payload = (await signIn.json().catch(() => null)) as { url?: string } | null
  if (!signIn.ok || !payload?.url) {
    logger.error('SSO sign-in did not return an authorization URL', {
      providerId,
      status: signIn.status,
    })
    return NextResponse.redirect(errorCallbackURL)
  }

  const response = NextResponse.redirect(payload.url)
  /** Better Auth's signed `state` cookie has to reach the browser before the identity provider does. */
  const signInHeaders = signIn.headers as Headers & { getSetCookie?: () => string[] }
  for (const cookie of signInHeaders.getSetCookie?.() ?? []) {
    response.headers.append('set-cookie', cookie)
  }
  return response
})
