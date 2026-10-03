import { vi } from 'vitest'

/** Shape of `BlockVisibilityState` from `@/lib/core/config/block-visibility`. */
export interface MockBlockVisibilityState {
  revealed: Set<string>
  disabled: Set<string>
  previewTagged: Set<string>
}

/**
 * Controllable mock functions for `@/lib/core/config/block-visibility`.
 *
 * Default: `mockGetBlockVisibility` resolves a fresh state with empty `revealed`, `disabled` and
 * `previewTagged` sets (nothing previewed, nothing disabled).
 *
 * @example
 * ```ts
 * import { blockVisibilityMockFns } from '@sim/testing/mocks/block-visibility.mock'
 *
 * blockVisibilityMockFns.mockGetBlockVisibility.mockResolvedValue({
 *   revealed: new Set(['my_block']), disabled: new Set(), previewTagged: new Set(),
 * })
 * ```
 */
export const blockVisibilityMockFns = {
  mockGetBlockVisibility: vi.fn(
    async (_ctx?: unknown): Promise<MockBlockVisibilityState> => ({
      revealed: new Set(),
      disabled: new Set(),
      previewTagged: new Set(),
    })
  ),
}

/**
 * Static mock module for `@/lib/core/config/block-visibility`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/core/config/block-visibility', () => blockVisibilityMock)
 * ```
 */
export const blockVisibilityMock = {
  getBlockVisibility: blockVisibilityMockFns.mockGetBlockVisibility,
}
