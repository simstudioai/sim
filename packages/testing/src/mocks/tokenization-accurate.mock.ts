import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/tokenization/accurate`.
 *
 * Default: `mockGetAccurateTokenCount` counts one token per character (`text.length`, `0` for an
 * empty string) — the stub most local factories used. `mockGetTokenStrings`,
 * `mockTruncateToTokenLimit`, `mockBatchByTokenLimit` and `mockClearEncodingCache` are bare.
 *
 * @example
 * ```ts
 * import { tokenizationAccurateMockFns } from '@sim/testing/mocks/tokenization-accurate.mock'
 *
 * tokenizationAccurateMockFns.mockGetAccurateTokenCount.mockReturnValue(7)
 * ```
 */
export const tokenizationAccurateMockFns = {
  mockGetAccurateTokenCount: vi.fn((text: string, _modelName?: string): number =>
    text ? text.length : 0
  ),
  mockGetTokenStrings: vi.fn(),
  mockTruncateToTokenLimit: vi.fn(),
  mockBatchByTokenLimit: vi.fn(),
  mockClearEncodingCache: vi.fn(),
}

/**
 * Static mock module for `@/lib/tokenization/accurate`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/tokenization/accurate', () => tokenizationAccurateMock)
 * ```
 */
export const tokenizationAccurateMock = {
  getAccurateTokenCount: tokenizationAccurateMockFns.mockGetAccurateTokenCount,
  getTokenStrings: tokenizationAccurateMockFns.mockGetTokenStrings,
  truncateToTokenLimit: tokenizationAccurateMockFns.mockTruncateToTokenLimit,
  batchByTokenLimit: tokenizationAccurateMockFns.mockBatchByTokenLimit,
  clearEncodingCache: tokenizationAccurateMockFns.mockClearEncodingCache,
}
