import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/core/config/feature-flags`.
 *
 * Defaults (the real result with AppConfig off and no fallback secret set):
 * - `mockIsFeatureEnabled` resolves `false` for every flag.
 * - `mockGetFeatureFlags` resolves `{}`.
 *
 * @example
 * ```ts
 * import { featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
 *
 * featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(async (flag) => flag === 'my-flag')
 * ```
 */
export const featureFlagsMockFns = {
  mockGetFeatureFlags: vi.fn(async (): Promise<Record<string, unknown>> => ({})),
  mockIsFeatureEnabled: vi.fn(async (_flag: string, _ctx?: unknown): Promise<boolean> => false),
}

/**
 * Static mock module for `@/lib/core/config/feature-flags`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
 * ```
 */
export const featureFlagsMock = {
  getFeatureFlags: featureFlagsMockFns.mockGetFeatureFlags,
  isFeatureEnabled: featureFlagsMockFns.mockIsFeatureEnabled,
}
