import { db, member, ssoProvider } from '@sim/db'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { listSsoProvidersContract } from '@/lib/api/contracts/auth'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { enforceIpRateLimit } from '@/lib/core/rate-limiter'
import { REDACTED_MARKER } from '@/lib/core/security/redaction'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('SSOProvidersRoute')

/** Secrets shorter than this reveal too large a fraction of themselves in 4 characters. */
const MIN_LENGTH_FOR_HINT = 16

/**
 * Last four characters of a stored client secret, so an admin can tell *which*
 * secret is saved rather than only that one exists. Four characters of a
 * high-entropy secret is not a meaningful disclosure to an owner or admin, who
 * can rotate it anyway — but short secrets are left unhinted, where the same four
 * characters would be a large share of the value.
 */
function buildClientSecretHint(clientSecret: unknown): string | null {
  if (typeof clientSecret !== 'string' || clientSecret.length < MIN_LENGTH_FOR_HINT) return null
  return clientSecret.slice(-4)
}

export const GET = withRouteHandler(async (request: NextRequest) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      const rateLimited = await enforceIpRateLimit('sso-providers', request, {
        maxTokens: 20,
        refillRate: 20,
        refillIntervalMs: 60_000,
      })
      if (rateLimited) return rateLimited
    }
    const parsed = await parseRequest(listSsoProvidersContract, request, {})
    if (!parsed.success) return parsed.response
    const { organizationId } = parsed.data.query

    let providers
    if (session?.user?.id) {
      const userId = session.user.id

      let verifiedOrganizationId: string | null = null
      if (organizationId) {
        const [membership] = await db
          .select({ organizationId: member.organizationId, role: member.role })
          .from(member)
          .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
          .limit(1)
        if (!membership) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }
        if (membership.role !== 'owner' && membership.role !== 'admin') {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }
        verifiedOrganizationId = membership.organizationId
      }

      const whereClause = verifiedOrganizationId
        ? eq(ssoProvider.organizationId, verifiedOrganizationId)
        : eq(ssoProvider.userId, userId)

      const results = await db
        .select({
          id: ssoProvider.id,
          providerId: ssoProvider.providerId,
          domain: ssoProvider.domain,
          issuer: ssoProvider.issuer,
          oidcConfig: ssoProvider.oidcConfig,
          samlConfig: ssoProvider.samlConfig,
          userId: ssoProvider.userId,
          organizationId: ssoProvider.organizationId,
          jitProvisioningEnabled: ssoProvider.jitProvisioningEnabled,
        })
        .from(ssoProvider)
        .where(whereClause)

      providers = results.map((provider) => {
        let oidcConfig = provider.oidcConfig
        if (oidcConfig) {
          try {
            const parsed = JSON.parse(oidcConfig)
            const hint = buildClientSecretHint(parsed.clientSecret)
            parsed.clientSecret = REDACTED_MARKER
            if (hint) parsed.clientSecretHint = hint
            oidcConfig = JSON.stringify(parsed)
          } catch {
            oidcConfig = null
          }
        }
        return {
          ...provider,
          oidcConfig,
          providerType: (provider.samlConfig ? 'saml' : 'oidc') as 'oidc' | 'saml',
        }
      })
    } else {
      const results = await db
        .select({
          domain: ssoProvider.domain,
        })
        .from(ssoProvider)

      providers = results.map((provider) => ({
        domain: provider.domain,
      }))
    }

    logger.info('Fetched SSO providers', {
      userId: session?.user?.id,
      authenticated: !!session?.user?.id,
      providerCount: providers.length,
    })

    return NextResponse.json({ providers })
  } catch (error) {
    logger.error('Failed to fetch SSO providers', { error })
    return NextResponse.json({ error: 'Failed to fetch SSO providers' }, { status: 500 })
  }
})
