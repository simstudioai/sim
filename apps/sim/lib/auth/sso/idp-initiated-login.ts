import { db, ssoProvider } from '@sim/db'
import { and, eq, isNull } from 'drizzle-orm'

/** Issuers compare without trailing slashes, which identity providers add or drop freely. */
function normalizeIssuer(issuer: string): string {
  return issuer.trim().replace(/\/+$/, '')
}

/**
 * Names the provider a login started from an identity provider's app dashboard
 * signs in through (OpenID Connect third-party initiated login).
 *
 * The identity provider opens the provider's initiate login URL with its own issuer
 * in `iss`. The URL is honored only for a domain-verified OIDC provider whose
 * configured issuer is that one, so a crafted link cannot start sign-in against
 * another identity provider. `null` falls back to the ordinary sign-in link.
 */
export async function resolveIdpInitiatedLoginProvider(
  providerId: string,
  issuer: string
): Promise<string | null> {
  const [provider] = await db
    .select({ providerId: ssoProvider.providerId, issuer: ssoProvider.issuer })
    .from(ssoProvider)
    .where(
      and(
        eq(ssoProvider.providerId, providerId),
        eq(ssoProvider.domainVerified, true),
        isNull(ssoProvider.samlConfig)
      )
    )
    .limit(1)
  if (!provider || normalizeIssuer(provider.issuer) !== normalizeIssuer(issuer)) return null
  return provider.providerId
}
