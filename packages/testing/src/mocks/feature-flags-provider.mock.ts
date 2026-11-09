import { vi } from 'vitest'

/**
 * Controllable `useFeatureFlag`, for `@/lib/core/config/feature-flags-context`.
 * Every flag reads as off unless a test says otherwise.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/core/config/feature-flags-context', () => featureFlagsProviderMock)
 * ```
 */
const featureFlagsProviderMockFns = {
  mockUseFeatureFlag: vi.fn((_name: string): boolean => false),
}

export const featureFlagsProviderMock = {
  useFeatureFlag: featureFlagsProviderMockFns.mockUseFeatureFlag,
}
