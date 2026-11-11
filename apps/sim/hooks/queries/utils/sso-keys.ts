export const SSO_PROVIDERS_STALE_TIME = 5 * 60 * 1000

/**
 * Query key factories for SSO-related queries
 */
export const ssoKeys = {
  all: ['sso'] as const,
  providers: () => [...ssoKeys.all, 'providers'] as const,
  providerList: (organizationId?: string) =>
    [...ssoKeys.providers(), organizationId ?? ''] as const,
  /**
   * Whether members must sign in through the identity provider. Under the same root as the
   * providers it depends on, so a provider change invalidates both in one call.
   */
  policies: () => [...ssoKeys.all, 'policy'] as const,
  policy: (organizationId?: string) => [...ssoKeys.policies(), organizationId ?? ''] as const,
}
