import { vi } from 'vitest'

/**
 * Controllable `useFeatureFlag` for `@/app/workspace/[workspaceId]/providers/feature-flags-provider`.
 * Every flag reads as off unless a test says otherwise.
 *
 * @example
 * ```ts
 * vi.mock('@/app/workspace/[workspaceId]/providers/feature-flags-provider', () => featureFlagsProviderMock)
 * featureFlagsProviderMockFns.mockUseFeatureFlag.mockImplementation((name) => name === 'plan')
 * ```
 */
export const featureFlagsProviderMockFns = {
  mockUseFeatureFlag: vi.fn((_name: string): boolean => false),
}

export const featureFlagsProviderMock = {
  useFeatureFlag: featureFlagsProviderMockFns.mockUseFeatureFlag,
}
