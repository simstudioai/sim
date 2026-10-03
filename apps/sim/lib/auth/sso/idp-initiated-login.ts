import { db, ssoProvider } from '@sim/db'
import { and, eq, isNull } from 'drizzle-orm'

/** Issuers compare without trailing slashes, which identity providers add or drop freely. */
function normalizeIssuer(issuer: string): string {
  return issuer.trim().replace(/\/+$/, '')
}

/** The issuer's origin, so an Okta custom authorization server matches its organization URL. */
function issuerOrigin(issuer: string): string | null {
  try {
    return new URL(issuer).origin
  } catch {
    return null
  }
}

/**
 * Whether an identity provider's app dashboard may start sign-in through this provider
 * (OpenID Connect third-party initiated login).
 *
 * The dashboard opens the provider's initiate login URL with its own issuer in `iss`. It is
 * honored only for a domain-verified OIDC provider configured with that issuer, or one on the
 * same host — Okta sends the organization URL even for a provider registered against a custom
 * authorization server under it. The gate is defense in depth: a crafted link can then only
 * reach an identity provider this deployment already registered, never an attacker's own, and
 * Better Auth re-checks the provider before it issues the authorization request.
 */
export async function isIdpInitiatedLoginAllowed(
  providerId: string,
  issuer: string
): Promise<boolean> {
  const [provider] = await db
    .select({ issuer: ssoProvider.issuer })
    .from(ssoProvider)
    .where(
      and(
        eq(ssoProvider.providerId, providerId),
        eq(ssoProvider.domainVerified, true),
        isNull(ssoProvider.samlConfig)
      )
    )
    .limit(1)
  if (!provider) return false

  const configured = normalizeIssuer(provider.issuer)
  const opened = normalizeIssuer(issuer)
  if (configured === opened) return true
  const configuredOrigin = issuerOrigin(configured)
  return configuredOrigin !== null && configuredOrigin === issuerOrigin(opened)
}
