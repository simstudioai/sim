/** Anonymous user ID used when DISABLE_AUTH is enabled */
export const ANONYMOUS_USER_ID = '00000000-0000-0000-0000-000000000000'

export const ANONYMOUS_USER = {
  id: ANONYMOUS_USER_ID,
  name: 'Anonymous',
  email: 'anonymous@localhost',
  emailVerified: true,
  image: null,
} as const

/**
 * Provider IDs permitted to authenticate (create or link a session) through the
 * unauthenticated sign-in endpoints `/sign-in/social` and `/sign-in/oauth2`.
 *
 * Only first-party login providers that verify email ownership belong here.
 * Integration connectors (Salesforce, Jira, the Microsoft/Google work
 * connectors, etc.) are deliberately excluded: they are connected exclusively
 * through the authenticated `/oauth2/link` flow, which binds the new account to
 * the current session user and never mints a session. Allowing a connector to
 * reach the sign-in endpoints enables nOAuth-style account takeover, where a
 * multi-tenant IdP asserting an attacker-controlled, unverified email mints a
 * session for the matching existing user. SSO uses a separate `/sign-in/sso`
 * endpoint and is unaffected by this list.
 */
export const SIGN_IN_PROVIDER_IDS = ['google', 'github', 'microsoft'] as const

const signInProviderIdSet: ReadonlySet<string> = new Set(SIGN_IN_PROVIDER_IDS)

/**
 * Returns true when `providerId` is a first-party login provider allowed to sign
 * in. Used to reject integration connectors at the sign-in endpoints so they can
 * only ever be connected through the authenticated link flow.
 */
export function isSignInProviderAllowed(providerId: unknown): boolean {
  return typeof providerId === 'string' && signInProviderIdSet.has(providerId)
}

/**
 * Resolves the provider identifier the sign-in handler will actually act on for a
 * given auth path. Better Auth reads `provider` on `/sign-in/social` and
 * `providerId` on `/sign-in/oauth2`, so the allowlist guard must read the same
 * field the handler uses. Reading the wrong field would let a request pass the
 * guard with an allowed value in one field while the handler starts OAuth for a
 * blocked value in the other, reopening connector sign-in.
 */
export function getRequestedSignInProviderId(
  path: string,
  body: { provider?: unknown; providerId?: unknown } | null | undefined
): unknown {
  if (path === '/sign-in/social') return body?.provider
  if (path === '/sign-in/oauth2') return body?.providerId
  return undefined
}
