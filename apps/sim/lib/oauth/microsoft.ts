import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'

/**
 * Scoped `'Auth'` because these lines are emitted from the OAuth callback path
 * and were logged under that scope before this helper moved here; renaming the
 * scope would break existing log queries and alerts.
 */
const logger = createLogger('Auth')

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

/**
 * True when Entra asserts the token's email is domain-verified via the
 * `xms_edov` optional claim — emitted only when the email's domain belongs to
 * the user's own tenant and a tenant admin verified that domain. This is the
 * one email signal a hostile tenant cannot forge (the nOAuth attack turns on
 * `email` being freely settable), and Microsoft's documented mitigation.
 *
 * The claim requires `xms_edov` and `email` to be configured as optional
 * claims on the app registration; when absent this returns `false` and callers
 * fall back to the prior behavior unchanged.
 *
 * @see https://learn.microsoft.com/en-us/entra/identity-platform/optional-claims-reference
 */
function isMicrosoftEmailDomainVerified(claims: Record<string, unknown>): boolean {
  const edov = claims.xms_edov
  return edov === true || edov === 'true' || edov === 1 || edov === '1'
}

/**
 * Raises `emailVerified` for Microsoft *sign-in* when — and only when — Entra
 * asserts domain ownership. Better Auth spreads this result over its own
 * derived profile, so returning an empty object leaves its computation
 * untouched: this can promote an unverified email to verified, never the
 * reverse.
 *
 * Why it matters: `microsoft` is deliberately absent from
 * `accountLinking.trustedProviders`, so Better Auth refuses to link a Microsoft
 * identity onto an existing user row unless the IdP asserts a verified email.
 * Entra never emits `email_verified` for work/school accounts, so without this
 * every user who already has a Sim account is permanently locked out of the
 * Microsoft button with an `account_not_linked` error. `xms_edov` is what lets
 * the honest case through while still refusing the forged one.
 */
export function mapMicrosoftProfileToUser(
  profile: Record<string, unknown>
): { emailVerified: true } | Record<string, never> {
  return isMicrosoftEmailDomainVerified(profile) ? { emailVerified: true } : {}
}

/**
 * Extracts user info from a Microsoft ID token JWT instead of calling Graph API /me.
 * This avoids 403 errors for external tenant users whose admin hasn't consented to Graph API scopes.
 * The ID token is always returned when the openid scope is requested.
 */
export function getMicrosoftUserInfoFromIdToken(
  tokens: { accessToken?: string },
  providerId: string
) {
  const idToken = (tokens as Record<string, unknown>).idToken as string | undefined
  if (!idToken) {
    logger.error(
      `Microsoft ${providerId} OAuth: no ID token received. Ensure openid scope is requested.`
    )
    throw new Error(`Microsoft ${providerId} OAuth requires an ID token (openid scope)`)
  }

  const parts = idToken.split('.')
  if (parts.length !== 3) {
    throw new Error(`Microsoft ${providerId} OAuth: malformed ID token`)
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'))
  } catch {
    throw new Error(`Microsoft ${providerId} OAuth: failed to decode ID token payload`)
  }

  const email =
    (payload.email as string) || (payload.preferred_username as string) || (payload.upn as string)
  if (!email) {
    throw new Error(
      `Microsoft ${providerId} OAuth: ID token contains no email, preferred_username, or upn claim`
    )
  }

  const emailVerified = deriveMicrosoftEmailVerified(payload, email)

  const now = new Date()
  return {
    id: `${payload.oid || payload.sub}-${generateId()}`,
    name: (payload.name as string) || 'Microsoft User',
    email,
    emailVerified,
    createdAt: now,
    updatedAt: now,
  }
}
