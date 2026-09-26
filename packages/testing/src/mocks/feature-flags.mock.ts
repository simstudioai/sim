import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/core/config/feature-flags`.
 *
 * Defaults:
 * - `mockIsFeatureEnabled` resolves `false` for every flag — the real result with AppConfig off
 *   and no fallback secret set.
 * - `mockGetFeatureFlags` resolves `{}`. The real module instead returns one
 *   `{ enabled: false }` entry per registered flag in that state (its `fallbackFlags()`); a
 *   missing entry and a disabled one evaluate the same, so override this only when a test
 *   inspects the document itself.
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
