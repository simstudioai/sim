const MICROSOFT_REFRESH_TOKEN_LIFETIME_DAYS = 90
export const PROACTIVE_REFRESH_THRESHOLD_DAYS = 7

export const MICROSOFT_PROVIDERS = new Set([
  'microsoft-ad',
  'microsoft-dataverse',
  'microsoft-excel',
  'microsoft-planner',
  'microsoft-teams',
  'outlook',
  'onedrive',
  'sharepoint',
])

export function isMicrosoftProvider(providerId: string): boolean {
  return MICROSOFT_PROVIDERS.has(providerId)
}

export function getMicrosoftRefreshTokenExpiry(): Date {
  return new Date(Date.now() + MICROSOFT_REFRESH_TOKEN_LIFETIME_DAYS * 24 * 60 * 60 * 1000)
}

/**
 * Derives whether a Microsoft ID token proves ownership of `email`. Azure AD's
 * `email`/`upn` claims are unverified and mutable on multi-tenant (`/common/`)
 * endpoints, so the email is trusted only when the token explicitly proves it via
 * the `email_verified` claim or the verified-email claims, mirroring Better
 * Auth's built-in Microsoft provider. Defaults to `false` when no claim asserts
 * verification, so an attacker-controlled tenant can never assert a verified
 * email it does not own.
 */
export function deriveMicrosoftEmailVerified(
  claims: Record<string, unknown>,
  email: string
): boolean {
  if (claims.email_verified !== undefined) {
    return Boolean(claims.email_verified)
  }
  const { verified_primary_email: verifiedPrimary, verified_secondary_email: verifiedSecondary } =
    claims
  return (
    (Array.isArray(verifiedPrimary) && verifiedPrimary.includes(email)) ||
    (Array.isArray(verifiedSecondary) && verifiedSecondary.includes(email))
  )
}
