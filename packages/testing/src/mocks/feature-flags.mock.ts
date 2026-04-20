import { vi } from 'vitest'

/**
 * Static mock module for `@/lib/core/config/feature-flags`.
 * All boolean flags default to `false` for safe test isolation.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
 * ```
 */
export const featureFlagsMock = {
  isProd: false,
  isDev: false,
  isTest: true,
  isHosted: false,
  isBillingEnabled: false,
  isEmailVerificationEnabled: false,
  isAuthDisabled: false,
  isRegistrationDisabled: false,
  isEmailPasswordEnabled: false,
  isSignupEmailValidationEnabled: false,
  isTriggerDevEnabled: false,
  isSsoEnabled: false,
  isCredentialSetsEnabled: false,
  isAccessControlEnabled: false,
  isOrganizationsEnabled: false,
  isInboxEnabled: false,
  isWhitelabelingEnabled: false,
  isAuditLogsEnabled: false,
  isE2bEnabled: false,
  isOllamaConfigured: false,
  isAzureConfigured: false,
  isInvitationsDisabled: false,
  isPublicApiDisabled: false,
  isGoogleAuthDisabled: false,
  isGithubAuthDisabled: false,
  isReactGrabEnabled: false,
  isReactScanEnabled: false,
  getAllowedIntegrationsFromEnv: vi.fn().mockReturnValue(null),
  getBlacklistedProvidersFromEnv: vi.fn().mockReturnValue([]),
  getAllowedMcpDomainsFromEnv: vi.fn().mockReturnValue(null),
  getCostMultiplier: vi.fn().mockReturnValue(1),
}
