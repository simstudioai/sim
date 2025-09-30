import { db, ssoProvider } from '@sim/db'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('SSO-Providers')

export async function GET(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: req.headers })

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
      // Unauthenticated users can only see basic info (domain only)
      // This is needed for SSO login flow to check if a domain has SSO enabled
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
