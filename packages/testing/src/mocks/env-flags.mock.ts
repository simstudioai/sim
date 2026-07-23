import { vi } from 'vitest'

/**
 * Mutable value-export state for the shared `@/lib/core/config/env-flags` mock.
 * Defaults mirror the real module evaluated under the vitest environment
 * (NODE_ENV=test, no feature env vars set): only `isTest` and
 * `isEmailPasswordEnabled` are true.
 */
export interface EnvFlagsMockState {
  isProd: boolean
  isDev: boolean
  isTest: boolean
  isHosted: boolean
  isCopilotBillingAttributionV1Enabled: boolean
  isCopilotBillingProtocolRequired: boolean
  isBillingEnabled: boolean
  isEmailVerificationEnabled: boolean
  isAuthDisabled: boolean
  isPrivateDatabaseHostsAllowed: boolean
  isRegistrationDisabled: boolean
  isEmailPasswordEnabled: boolean
  isSignupMxValidationEnabled: boolean
  isAppConfigEnabled: boolean
  isTriggerDevEnabled: boolean
  isSsoEnabled: boolean
  isAccessControlEnabled: boolean
  isOrganizationsEnabled: boolean
  isInboxEnabled: boolean
  isWhitelabelingEnabled: boolean
  isAuditLogsEnabled: boolean
  isDataRetentionEnabled: boolean
  isDataDrainsEnabled: boolean
  isForkingEnabled: boolean
  isE2bEnabled: boolean
  isE2BDocEnabled: boolean
  isOllamaConfigured: boolean
  isAzureConfigured: boolean
  isCohereConfigured: boolean
  isInvitationsDisabled: boolean
  isPublicApiDisabled: boolean
  isGoogleAuthDisabled: boolean
  isGithubAuthDisabled: boolean
  isMicrosoftAuthDisabled: boolean
  isEmailSignupDisabled: boolean
  isReactGrabEnabled: boolean
  isReactScanEnabled: boolean
}

const defaultEnvFlagsState: EnvFlagsMockState = {
  isProd: false,
  isDev: false,
  isTest: true,
  isHosted: false,
  isCopilotBillingAttributionV1Enabled: false,
  isCopilotBillingProtocolRequired: false,
  isBillingEnabled: false,
  isEmailVerificationEnabled: false,
  isAuthDisabled: false,
  isPrivateDatabaseHostsAllowed: false,
  isRegistrationDisabled: false,
  isEmailPasswordEnabled: true,
  isSignupMxValidationEnabled: false,
  isAppConfigEnabled: false,
  isTriggerDevEnabled: false,
  isSsoEnabled: false,
  isAccessControlEnabled: false,
  isOrganizationsEnabled: false,
  isInboxEnabled: false,
  isWhitelabelingEnabled: false,
  isAuditLogsEnabled: false,
  isDataRetentionEnabled: false,
  isDataDrainsEnabled: false,
  isForkingEnabled: false,
  isE2bEnabled: false,
  isE2BDocEnabled: false,
  isOllamaConfigured: false,
  isAzureConfigured: false,
  isCohereConfigured: false,
  isInvitationsDisabled: false,
  isPublicApiDisabled: false,
  isGoogleAuthDisabled: false,
  isGithubAuthDisabled: false,
  isMicrosoftAuthDisabled: false,
  isEmailSignupDisabled: false,
  isReactGrabEnabled: false,
  isReactScanEnabled: false,
}

const envFlagsState: EnvFlagsMockState = { ...defaultEnvFlagsState }

/**
 * Controllable mock functions for the function exports of
 * `@/lib/core/config/env-flags`. Override per-test, e.g.
 * `envFlagsMockFns.getCostMultiplier.mockReturnValue(2)`.
 * {@link resetEnvFlagsMock} restores the default implementations.
 */
export const envFlagsMockFns = {
  getAllowedIntegrationsFromEnv: vi.fn<() => string[] | null>(() => null),
  getPreviewBlocksFromEnv: vi.fn<() => string[]>(() => []),
  getBlacklistedProvidersFromEnv: vi.fn<() => string[]>(() => []),
  getAllowedMcpDomainsFromEnv: vi.fn<() => string[] | null>(() => null),
  getCostMultiplier: vi.fn<() => number>(() => 1),
}

/**
 * Applies per-test overrides to the shared env-flags mock state.
 * Reads through the mocked module observe the new values immediately.
 *
 * @example
 * ```ts
 * beforeEach(() => {
 *   setEnvFlags({ isBillingEnabled: true, isHosted: true })
 * })
 * afterAll(resetEnvFlagsMock)
 * ```
 */
export function setEnvFlags(overrides: Partial<EnvFlagsMockState>): void {
  Object.assign(envFlagsState, overrides)
}

/**
 * Restores the shared env-flags mock to its defaults: default flag state and
 * default implementations for the function exports.
 */
export function resetEnvFlagsMock(): void {
  Object.assign(envFlagsState, defaultEnvFlagsState)
  envFlagsMockFns.getAllowedIntegrationsFromEnv.mockReset().mockImplementation(() => null)
  envFlagsMockFns.getPreviewBlocksFromEnv.mockReset().mockImplementation(() => [])
  envFlagsMockFns.getBlacklistedProvidersFromEnv.mockReset().mockImplementation(() => [])
  envFlagsMockFns.getAllowedMcpDomainsFromEnv.mockReset().mockImplementation(() => null)
  envFlagsMockFns.getCostMultiplier.mockReset().mockImplementation(() => 1)
}

/**
 * Builds a live get/set accessor pair for one flag so both reads through the
 * mocked module and direct assignments (`envFlagsMock.isHosted = true`)
 * delegate to the shared mutable state.
 */
function flagAccessor(key: keyof EnvFlagsMockState): PropertyDescriptor {
  return {
    enumerable: true,
    get: () => envFlagsState[key],
    set: (value: boolean) => {
      envFlagsState[key] = value
    },
  }
}

/**
 * Complete, stateful mock module for `@/lib/core/config/env-flags`, installed
 * globally in `apps/sim/vitest.setup.ts`. Every export of the real module is
 * present. Flag reads are live: override via {@link setEnvFlags} (or direct
 * property assignment) and restore with {@link resetEnvFlagsMock}.
 */
export const envFlagsMock: EnvFlagsMockState & typeof envFlagsMockFns = Object.defineProperties(
  { ...envFlagsMockFns } as EnvFlagsMockState & typeof envFlagsMockFns,
  Object.fromEntries(
    (Object.keys(defaultEnvFlagsState) as (keyof EnvFlagsMockState)[]).map((key) => [
      key,
      flagAccessor(key),
    ])
  )
)
