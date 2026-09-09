import { db, ssoProvider } from '@sim/db'
import { normalizeSSODomain } from '@sim/utils/sso-domain'
import { and, asc, eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { resolveSsoProviderContract } from '@/lib/api/contracts/auth'
import { parseRequest } from '@/lib/api/server'
import { enforceIpRateLimit } from '@/lib/core/rate-limiter'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

/**
 * Names the identity provider that signs in an email address.
 *
 * Unauthenticated by nature, like the sign-in page that calls it, and admitted
 * per address. It discloses nothing the public provider list does not: which
 * domains have SSO, and the provider id that already appears in the callback
 * URL. Only a provider whose domain is verified is named: an unverified claim
 * has no authority over the address, and sending someone to its IdP would fail
 * at the callback anyway. Ties break on provider id so the answer is stable.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const rateLimited = await enforceIpRateLimit('sso-resolve', request, {
    maxTokens: 30,
    refillRate: 30,
    refillIntervalMs: 60_000,
  })
  if (rateLimited) return rateLimited

  const parsed = await parseRequest(resolveSsoProviderContract, request, {})
  if (!parsed.success) return parsed.response

  const domain = normalizeSSODomain(parsed.data.body.email)
  if (!domain) {
    return NextResponse.json({ error: 'Enter a valid work email address' }, { status: 400 })
  }

  const [provider] = await db
    .select({ providerId: ssoProvider.providerId, samlConfig: ssoProvider.samlConfig })
    .from(ssoProvider)
    .where(
      and(
        eq(ssoProvider.domainVerified, true),
        sql`lower(regexp_replace(btrim(${ssoProvider.domain}), '^\\*\\.', '')) = ${domain}`
      )
    )
    .orderBy(asc(ssoProvider.providerId))
    .limit(1)
  if (!provider) {
    return NextResponse.json(
      {
        error: 'No identity provider is configured for this email domain',
        code: 'SSO_NO_PROVIDER',
      },
      { status: 404 }
    )
  }

  return NextResponse.json({
    providerId: provider.providerId,
    providerType: provider.samlConfig ? 'saml' : 'oidc',
  })
})
