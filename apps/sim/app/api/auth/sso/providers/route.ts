import { db, ssoProvider } from '@sim/db'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { listSsoProvidersContract } from '@/lib/api/contracts/auth'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import {
  authorizeOrganizationSSOAdmin,
  ssoManagementErrorResponse,
} from '@/lib/auth/sso/management'
import { env, isTruthy } from '@/lib/core/config/env'
import { enforceIpRateLimit } from '@/lib/core/rate-limiter'
import { REDACTED_MARKER } from '@/lib/core/security/redaction'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('SSOProvidersRoute')

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
        await authorizeOrganizationSSOAdmin(userId, organizationId)
        verifiedOrganizationId = organizationId
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
          domainVerified: ssoProvider.domainVerified,
        })
        .from(ssoProvider)
        .where(whereClause)

      providers = results.map((provider) => {
        const { userId: creatorUserId, ...publicProvider } = provider
        let oidcConfig = provider.oidcConfig
        if (oidcConfig) {
          try {
            const parsed = JSON.parse(oidcConfig)
            parsed.clientSecret = REDACTED_MARKER
            oidcConfig = JSON.stringify(parsed)
          } catch {
            oidcConfig = null
          }
        }
        return {
          ...publicProvider,
          domainVerified: isTruthy(env.SSO_DOMAIN_VERIFICATION_ENABLED)
            ? provider.domainVerified
            : true,
          oidcConfig,
          providerType: (provider.samlConfig ? 'saml' : 'oidc') as 'oidc' | 'saml',
          isCreator: creatorUserId === userId,
          canManageVerification: creatorUserId === userId,
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
    const managedResponse = ssoManagementErrorResponse(error)
    if (managedResponse) return managedResponse
    logger.error('Failed to fetch SSO providers', { error })
    return NextResponse.json({ error: 'Failed to fetch SSO providers' }, { status: 500 })
  }
})
