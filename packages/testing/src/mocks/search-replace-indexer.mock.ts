import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/workflows/search-replace/indexer`.
 *
 * Defaults: `mockGetToolInputParamConfigs` returns `[]` (the tool exposes no param configs) and
 * `mockIndexWorkflowSearchMatches` returns `[]` (no matches).
 *
 * @example
 * ```ts
 * import { searchReplaceIndexerMockFns } from '@sim/testing/mocks/search-replace-indexer.mock'
 *
 * searchReplaceIndexerMockFns.mockGetToolInputParamConfigs.mockReturnValue([
 *   { paramId: 'apiKey', authoritative: true, value: 'k', config: { id: 'apiKey', type: 'short-input' } },
 * ])
 * ```
 */
export const searchReplaceIndexerMockFns = {
  mockGetToolInputParamConfigs: vi.fn((_options: unknown): unknown[] => []),
  mockIndexWorkflowSearchMatches: vi.fn((_options: unknown): unknown[] => []),
}

/**
 * Static mock module for `@/lib/workflows/search-replace/indexer`. Covers every runtime export.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/workflows/search-replace/indexer', () => searchReplaceIndexerMock)
 * ```
 */
export const searchReplaceIndexerMock = {
  getToolInputParamConfigs: searchReplaceIndexerMockFns.mockGetToolInputParamConfigs,
  indexWorkflowSearchMatches: searchReplaceIndexerMockFns.mockIndexWorkflowSearchMatches,
}
