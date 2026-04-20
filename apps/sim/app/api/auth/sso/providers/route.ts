import { db, ssoProvider } from '@sim/db'
import { createLogger } from '@sim/logger'
import { eq, or } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'

const logger = createLogger('SSOProvidersRoute')

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    const { searchParams } = new URL(request.url)
    const organizationId = searchParams.get('organizationId')

    let providers
    if (session?.user?.id) {
      const userId = session.user.id

      const whereClause = organizationId
        ? or(eq(ssoProvider.userId, userId), eq(ssoProvider.organizationId, organizationId))
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
        })
        .from(ssoProvider)
        .where(whereClause)

      providers = results.map((provider) => ({
        ...provider,
        providerType: (provider.samlConfig ? 'saml' : 'oidc') as 'oidc' | 'saml',
      }))
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
}
