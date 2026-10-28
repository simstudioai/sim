import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/knowledge/documents/secure-fetch.server`.
 * Both are bare `vi.fn()`s; a test that wants the transport to hit a fake `fetch`
 * sets `mockImplementation` itself.
 *
 * @example
 * ```ts
 * import { knowledgeSecureFetchMockFns } from '@sim/testing/mocks/knowledge-secure-fetch.mock'
 *
 * knowledgeSecureFetchMockFns.mockFetchWithRetry.mockResolvedValue(new Response('{}'))
 * ```
 */
export const knowledgeSecureFetchMockFns = {
  mockSecureFetchWithRetry: vi.fn(),
  mockFetchWithRetry: vi.fn(),
}

/**
 * Static mock module for `@/lib/knowledge/documents/secure-fetch.server`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/knowledge/documents/secure-fetch.server', () => knowledgeSecureFetchMock)
 * ```
 */
export const knowledgeSecureFetchMock = {
  secureFetchWithRetry: knowledgeSecureFetchMockFns.mockSecureFetchWithRetry,
  fetchWithRetry: knowledgeSecureFetchMockFns.mockFetchWithRetry,
}
