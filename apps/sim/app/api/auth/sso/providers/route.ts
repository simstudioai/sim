import { db, member, ssoDomain, ssoProvider } from '@sim/db'
import {
  isNamedPrimary,
  ssoProviderDomainKey,
  verifiedDomainOfProvider,
} from '@sim/db/sso-primary-provider'
import { createLogger } from '@sim/logger'
import { and, asc, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { listSsoProvidersContract } from '@/lib/api/contracts/auth'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { markSignInProviders } from '@/lib/auth/sso/primary-provider'
import { decryptProviderConfig } from '@/lib/auth/sso-provider-secrets'
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

/**
 * Replaces the stored client secret with the redaction marker, keeping a hint
 * built from the real secret. The stored value is decrypted first: a hint taken
 * from the envelope would be four characters of the auth tag, which says nothing
 * about the secret and changes every time the row is rewritten.
 */
async function redactOidcConfig(oidcConfig: string | null): Promise<string | null> {
  if (!oidcConfig) return oidcConfig
  /**
   * Outside the catch: a config that will not decrypt is a key problem, and
   * reporting it as a provider with no config would hide it behind a healthy
   * 200. Unreadable JSON stays tolerated below, as it was before.
   */
  const decrypted = await decryptProviderConfig(oidcConfig, 'oidcConfig')
  try {
    const parsed = JSON.parse(decrypted as string)
    const hint = buildClientSecretHint(parsed.clientSecret)
    parsed.clientSecret = REDACTED_MARKER
    if (hint) parsed.clientSecretHint = hint
    return JSON.stringify(parsed)
  } catch {
    return null
  }
}

/**
 * Drops the SAML key material an admin never needs back. Unlike the OIDC secret
 * these carry no hint: they are the service provider's own signing and
 * decryption keys, they are only ever set by the operator registration script,
 * and the settings form does not read them.
 */
function redactSamlConfig(samlConfig: string | null): string | null {
  if (!samlConfig) return samlConfig
  try {
    const parsed = JSON.parse(samlConfig)
    for (const field of ['privateKey', 'decryptionPvk']) {
      if (typeof parsed[field] === 'string' && parsed[field] !== '') parsed[field] = REDACTED_MARKER
    }
    return JSON.stringify(parsed)
  } catch {
    return null
  }
}

/**
 * Lists the identity providers the caller administers: an organization's when an
 * owner or admin names it, otherwise the ones the caller registered.
 *
 * Signed-in only. Sign-in resolves one address at a time through
 * `/api/auth/sso/resolve`; nothing needs every configured domain, and listing
 * them would publish which organizations use SSO.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const parsed = await parseRequest(listSsoProvidersContract, request, {})
    if (!parsed.success) return parsed.response
    const { organizationId } = parsed.data.query
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
        domainVerified: ssoProvider.domainVerified,
        domainKey: ssoProviderDomainKey,
        isNamedPrimary,
      })
      .from(ssoProvider)
      .leftJoin(ssoDomain, verifiedDomainOfProvider)
      .where(whereClause)
      .orderBy(asc(ssoProvider.providerId))

    const providers = await Promise.all(
      markSignInProviders(results).map(async (provider) => ({
        ...provider,
        oidcConfig: await redactOidcConfig(provider.oidcConfig),
        samlConfig: redactSamlConfig(provider.samlConfig),
        providerType: (provider.samlConfig ? 'saml' : 'oidc') as 'oidc' | 'saml',
      }))
    )

    logger.info('Fetched SSO providers', { userId, providerCount: providers.length })

    return NextResponse.json({ providers })
  } catch (error) {
    logger.error('Failed to fetch SSO providers', { error })
    return NextResponse.json({ error: 'Failed to fetch SSO providers' }, { status: 500 })
  }
})
