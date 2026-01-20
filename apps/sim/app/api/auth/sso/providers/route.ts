import { db, ssoProvider } from '@sim/db'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'

const logger = createLogger('SSOProvidersRoute')

export async function GET() {
  try {
    const session = await getSession()

    let providers
    if (session?.user?.id) {
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
        .where(eq(ssoProvider.userId, session.user.id))

      providers = results.map((provider) => ({
        ...provider,
        providerType:
          provider.oidcConfig && provider.samlConfig
            ? 'oidc'
            : provider.oidcConfig
              ? 'oidc'
              : provider.samlConfig
                ? 'saml'
                : ('oidc' as 'oidc' | 'saml'),
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
