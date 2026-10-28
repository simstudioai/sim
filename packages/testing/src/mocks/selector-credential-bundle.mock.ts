import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/selectors/server/providers/credential-bundle`. Bare
 * `vi.fn()`.
 *
 * @example
 * ```ts
 * import { selectorCredentialBundleMockFns } from '@sim/testing/mocks/selector-credential-bundle.mock'
 *
 * selectorCredentialBundleMockFns.mockResolveSelectorCredentialBundle.mockResolvedValue(bundle)
 * ```
 */
export const selectorCredentialBundleMockFns = {
  mockResolveSelectorCredentialBundle: vi.fn(),
}

/**
 * Static mock module for `@/lib/selectors/server/providers/credential-bundle`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/selectors/server/providers/credential-bundle', () => selectorCredentialBundleMock)
 * ```
 */
export const selectorCredentialBundleMock = {
  resolveSelectorCredentialBundle:
    selectorCredentialBundleMockFns.mockResolveSelectorCredentialBundle,
}
