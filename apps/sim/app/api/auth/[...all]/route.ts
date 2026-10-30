import { toNextJsHandler } from 'better-auth/next-js'
import { type NextRequest, NextResponse } from 'next/server'
import { sharedCredentialGroupOAuthCallbackContract } from '@/lib/api/contracts/credential-groups'
import { parseRequest } from '@/lib/api/server'
import { auth } from '@/lib/auth'
import { createAnonymousSession, ensureAnonymousUserExists } from '@/lib/auth/anonymous'
import { isAuthDisabled } from '@/lib/core/config/env-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { isCredentialGroupOAuthState } from '@/lib/credential-groups/oauth-state'
import { getCredentialGroupStandardOAuthProviderFromProviderId } from '@/lib/credential-groups/providers'
import { enforcePublicCredentialGroupIpRateLimit } from '@/lib/credential-groups/rate-limit'
import { handleCredentialGroupOAuthCallback } from '@/app/api/credential-groups/oauth-callback'

export const dynamic = 'force-dynamic'

const { GET: betterAuthGET, POST: betterAuthPOST } = toNextJsHandler(auth.handler)
const SAFE_ORGANIZATION_POST_PATHS = new Set(['organization/check-slug', 'organization/set-active'])
/**
 * Password-reset mail the plugin would send under a name Sim does not own.
 *
 * `/api/auth/forget-password` is an application route that owns the per-recipient budget (5 per 15
 * minutes, keyed on the address) and writes the `PASSWORD_RESET_REQUESTED` audit record. Every
 * plugin alias reaches the same mailer with only a per-IP default in front of it, which a caller
 * spread across addresses walks straight past, at one victim's mailbox. Matched rather than listed,
 * like the SSO and OAuth guards below, so a plugin version that renames or adds an alias cannot
 * quietly reopen the path.
 */
function isBlockedPasswordResetPath(path: string): boolean {
  return /(^|\/)(request-password-reset|forget-password)(\/|$)/.test(path)
}

/** The one OTP purpose a Sim surface sends: the resend button on `/verify`. */
const ALLOWED_VERIFICATION_OTP_TYPE = 'email-verification'
const VERIFICATION_OTP_SENDER_PATH = 'email-otp/send-verification-otp'

/**
 * The same mailer again, reached by asking the verification sender for a different purpose.
 *
 * `email-otp/send-verification-otp` takes the OTP `type` from the request body, and
 * `forget-password` there sends reset mail to any address named — so blocking the reset paths
 * above while leaving this one open would only rename the hole. The endpoint stays reachable for
 * the purpose the product actually sends, and an unreadable body is refused rather than forwarded.
 */
async function isBlockedVerificationOtpSend(request: NextRequest, path: string): Promise<boolean> {
  if (path !== VERIFICATION_OTP_SENDER_PATH) return false
  // boundary-raw-json: the plugin owns this endpoint's schema; the guard reads one field to decide whether to forward the request at all
  const body = await request
    .clone()
    .json()
    .catch(() => null)
  return (body as { type?: unknown } | null)?.type !== ALLOWED_VERIFICATION_OTP_TYPE
}

/**
 * Email OTP sign-in. No Sim surface sends a sign-in OTP (see the sender guard above), and for a user
 * whose email was never verified the plugin's sign-in deletes every linked account and session
 * before signing in — integration credentials included. Unreachable rather than relying on no OTP
 * of that type ever existing.
 */
const EMAIL_OTP_SIGN_IN_PATH = 'sign-in/email-otp'

/**
 * Better Auth 1.6 also served SAML responses at `sso/saml2/callback/:providerId`, and providers
 * registered before 1.7 advertise that URL in their stored SP metadata and in their IdP's ACS
 * configuration. 1.7 serves only `sso/saml2/sp/acs/:providerId`, which still accepts the legacy
 * URL as a Destination/Recipient because the stored SP metadata names it.
 */
const LEGACY_SAML_CALLBACK_PATH = /^sso\/saml2\/callback\/([^/]+)$/

/** The same request — method, headers, query, and streamed body — addressed to another auth path. */
function forwardToAuthPath(request: NextRequest, authPath: string): Request {
  const url = new URL(request.url)
  url.pathname = `/api/auth/${authPath}`
  return new Request(url, request)
}

function toSamlAcsRequest(request: NextRequest, path: string): Request | null {
  const providerId = LEGACY_SAML_CALLBACK_PATH.exec(path)?.[1]
  return providerId ? forwardToAuthPath(request, `sso/saml2/sp/acs/${providerId}`) : null
}

const OAUTH_CALLBACK_PATH_PREFIX = 'oauth2/callback/'
const UNSUPPORTED_OIDC_PATHS = new Set([
  '.well-known/openid-configuration',
  'oauth2/end-session',
  'oauth2/userinfo',
])

/**
 * SAML protocol endpoints the IdP posts to (`saml2/callback/:id`,
 * `saml2/sp/acs/:id`, `saml2/sp/slo/:id`, `saml2/logout/:id`). These are the
 * only SSO paths the plugin must keep serving on POST — every other SSO POST
 * endpoint it registers is a provider mutation.
 */
const SAML_PROTOCOL_POST_PREFIX = 'sso/saml2/'

/**
 * Provider endpoints served by the plugin. Token and revocation requests have
 * dedicated routes that own their validation and token-family lifecycle.
 */
const OAUTH_PROVIDER_PROTOCOL_POST_PATHS = new Set([
  'oauth2/consent',
  'oauth2/continue',
  'oauth2/public-client-prelogin',
])

function getAuthPath(request: NextRequest): string {
  const pathname = request.nextUrl?.pathname ?? new URL(request.url).pathname
  return pathname.replace('/api/auth/', '')
}

function isBlockedOrganizationMutationPath(path: string): boolean {
  return path.startsWith('organization/') && !SAFE_ORGANIZATION_POST_PATHS.has(path)
}

/**
 * The provider id of a connector callback on the redirect URI registered with each provider
 * (`/api/auth/oauth2/callback/:id`). Better Auth 1.7 serves it at core's `/callback/:id`; the
 * registered URIs stay as they are, so these requests are forwarded there.
 */
function getConnectorCallbackProviderId(path: string): string | null {
  if (!path.startsWith(OAUTH_CALLBACK_PATH_PREFIX)) return null
  const providerId = path.slice(OAUTH_CALLBACK_PATH_PREFIX.length)
  return providerId && !providerId.includes('/') ? providerId : null
}

function getCredentialGroupCallbackProviderId(request: NextRequest, path: string): string | null {
  const state = request.nextUrl.searchParams.get('state')
  if (!state || !isCredentialGroupOAuthState(state)) return null
  return getConnectorCallbackProviderId(path)
}

/**
 * SSO provider configuration is owned by `/api/auth/sso/register`, which proves
 * domain ownership before granting trust and restricts the attribute mapping to
 * `email`/`name`/`image`. The plugin's own `sso/update-provider` bypasses
 * both: it is gated only on provider ownership and merges the caller's config,
 * so a provider owner could add `mapping.emailVerified` — a change the plugin's
 * identity-boundary guard does not consider, so it never trips the linked-account
 * conflict — and then assert an arbitrary victim's email as verified to auto-link
 * into their account. `sso/delete-provider` likewise lets an owner drop a login
 * path outside the application's flow.
 *
 * `trustEmailVerified: false` independently defuses that claim, so these two
 * guards are layered, not redundant: this one keeps provider configuration
 * owned by the register route (which alone proves domain ownership) and is what
 * stops the mapping rewrite from becoming live again if that option is ever
 * reconsidered.
 *
 * Deny-by-default rather than a blocklist so a future plugin version cannot
 * introduce another unshadowed provider mutation.
 */
function isBlockedSsoMutationPath(path: string): boolean {
  return path.startsWith('sso/') && !path.startsWith(SAML_PROTOCOL_POST_PREFIX)
}

/**
 * Client registration and client/consent mutation are not Sim's OAuth surface.
 *
 * `allowDynamicClientRegistration: false` gates only `/oauth2/register`; the
 * plugin's `/oauth2/create-client`, `/update-client`, `/delete-client`,
 * `/client/rotate-secret` and `/update-consent` are separate endpoints whose
 * only guard is a session, so without this any signed-in user could register a
 * client with arbitrary redirect URIs and the full scope set, then phish a
 * token out of somebody else — or widen their own grant past what they
 * consented to. Clients are operator-created rows (see
 * `apps/sim/scripts/create-oauth-client.ts`), and a consent is changed by
 * granting or revoking it, never by editing the row.
 *
 * Deny-by-default, like the SSO block above, so a future plugin version cannot
 * introduce another unshadowed mutation endpoint. Connectors link through core's
 * `/link-social` and return on GET, so no `oauth2/` POST belongs to them.
 */
function isBlockedOAuthProviderMutationPath(path: string): boolean {
  if (!path.startsWith('oauth2/')) return false
  return !OAUTH_PROVIDER_PROTOCOL_POST_PATHS.has(path)
}

/** Sim exposes OAuth API authorization, not an OpenID Connect identity provider. */
function unsupportedOidcResponse(): NextResponse {
  return NextResponse.json(
    { error: 'OpenID Connect is not available.' },
    { status: 404, headers: { 'Cache-Control': 'no-store' } }
  )
}

export const GET = withRouteHandler(async (request: NextRequest) => {
  const path = getAuthPath(request)
  if (UNSUPPORTED_OIDC_PATHS.has(path)) return unsupportedOidcResponse()
  const credentialGroupProviderId = getCredentialGroupCallbackProviderId(request, path)

  if (credentialGroupProviderId) {
    const limited = await enforcePublicCredentialGroupIpRateLimit(request, 'oauth-callback')
    const parsed = await parseRequest(sharedCredentialGroupOAuthCallbackContract, request, {
      params: Promise.resolve({ providerId: credentialGroupProviderId }),
    })
    if (!parsed.success) return limited ?? parsed.response

    let provider
    try {
      provider = getCredentialGroupStandardOAuthProviderFromProviderId(
        parsed.data.params.providerId
      )
    } catch {
      return NextResponse.json(
        { error: 'Unsupported managed OAuth provider.' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      )
    }
    return handleCredentialGroupOAuthCallback({
      request,
      provider,
      query: parsed.data.query,
      limited,
    })
  }

  const connectorCallbackProviderId = getConnectorCallbackProviderId(path)
  if (connectorCallbackProviderId) {
    return betterAuthGET(
      forwardToAuthPath(request, `callback/${encodeURIComponent(connectorCallbackProviderId)}`)
    )
  }

  const samlAcsRequest = toSamlAcsRequest(request, path)
  if (samlAcsRequest) return betterAuthGET(samlAcsRequest)

  if (path === 'get-session' && isAuthDisabled) {
    await ensureAnonymousUserExists()
    return NextResponse.json(createAnonymousSession())
  }

  return betterAuthGET(request)
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  const path = getAuthPath(request)
  if (UNSUPPORTED_OIDC_PATHS.has(path)) return unsupportedOidcResponse()

  if (isBlockedOrganizationMutationPath(path)) {
    return NextResponse.json(
      { error: 'Organization mutations are handled by application API routes.' },
      { status: 404 }
    )
  }

  if (isBlockedSsoMutationPath(path)) {
    return NextResponse.json(
      { error: 'SSO provider mutations are handled by application API routes.' },
      { status: 404 }
    )
  }

  if (isBlockedPasswordResetPath(path) || (await isBlockedVerificationOtpSend(request, path))) {
    return NextResponse.json(
      { error: 'Password reset is handled by application API routes.' },
      { status: 404 }
    )
  }

  if (path === EMAIL_OTP_SIGN_IN_PATH) {
    return NextResponse.json({ error: 'Email code sign-in is not available.' }, { status: 404 })
  }

  if (isBlockedOAuthProviderMutationPath(path)) {
    return NextResponse.json(
      { error: 'OAuth client registration is not available.' },
      { status: 404 }
    )
  }

  if (OAUTH_PROVIDER_PROTOCOL_POST_PATHS.has(path) && isAuthDisabled) {
    return NextResponse.json(
      { error: 'OAuth provider is not enabled' },
      { status: 404, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } }
    )
  }

  return betterAuthPOST(toSamlAcsRequest(request, path) ?? request)
})
