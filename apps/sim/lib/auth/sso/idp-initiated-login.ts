import { db, ssoProvider } from '@sim/db'
import { and, eq } from 'drizzle-orm'

/** Issuers compare without trailing slashes, which identity providers add or drop freely. */
function normalizeIssuer(issuer: string): string {
  return issuer.trim().replace(/\/+$/, '')
}

/**
 * Names the provider a login started from an identity provider's app dashboard
 * signs in through (OpenID Connect third-party initiated login).
 *
 * The identity provider opens the provider's sign-in link with its own issuer in
 * `iss`. The link is honored only for a domain-verified provider whose configured
 * issuer is that one, so a crafted link cannot start sign-in against another
 * identity provider. `null` leaves the sign-in page as it is.
 */
export async function resolveIdpInitiatedLoginProvider(
  providerId: string,
  issuer: string
): Promise<string | null> {
  const [provider] = await db
    .select({ providerId: ssoProvider.providerId, issuer: ssoProvider.issuer })
    .from(ssoProvider)
    .where(and(eq(ssoProvider.providerId, providerId), eq(ssoProvider.domainVerified, true)))
    .limit(1)
  if (!provider || normalizeIssuer(provider.issuer) !== normalizeIssuer(issuer)) return null
  return provider.providerId
}
