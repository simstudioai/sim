import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/api-key/byok`.
 *
 * Defaults: `mockGetBYOKKey` resolves `null` (no workspace or organization key configured).
 * `mockGetApiKeyWithBYOK` is a bare `vi.fn()`.
 *
 * @example
 * ```ts
 * import { apiKeyByokMockFns } from '@sim/testing/mocks/api-key-byok.mock'
 *
 * apiKeyByokMockFns.mockGetBYOKKey.mockResolvedValue({ apiKey: 'sk-byok', isBYOK: true, scope: 'workspace' })
 * ```
 */
export const apiKeyByokMockFns = {
  mockGetBYOKKey: vi.fn(
    async (
      _workspaceId: string | undefined | null,
      _providerId: string,
      _options?: { failClosed?: boolean }
    ): Promise<unknown> => null
  ),
  mockGetApiKeyWithBYOK: vi.fn(),
}

/**
 * Static mock module for `@/lib/api-key/byok`. Covers every runtime export.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/api-key/byok', () => apiKeyByokMock)
 * ```
 */
export const apiKeyByokMock = {
  getBYOKKey: apiKeyByokMockFns.mockGetBYOKKey,
  getApiKeyWithBYOK: apiKeyByokMockFns.mockGetApiKeyWithBYOK,
}
