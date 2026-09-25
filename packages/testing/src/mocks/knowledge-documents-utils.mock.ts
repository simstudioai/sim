import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/knowledge/documents/utils` (the retry helpers).
 *
 * Defaults: `mockReadBoundedHttpErrorBody` resolves the response's full `text()` (the shared
 * local stub, not the real omitted-body placeholder). Everything else is a bare `vi.fn()`.
 *
 * @example
 * ```ts
 * import { knowledgeDocumentsUtilsMockFns } from '@sim/testing/mocks/knowledge-documents-utils.mock'
 *
 * knowledgeDocumentsUtilsMockFns.mockRetryWithExponentialBackoff.mockImplementation((op) => op())
 * ```
 */
export const knowledgeDocumentsUtilsMockFns = {
  mockReadBoundedHttpErrorBody: vi.fn(
    async (response: { text?: () => Promise<string> }): Promise<string> =>
      response.text ? response.text() : ''
  ),
  mockReadBoundedHttpErrorPayload: vi.fn(),
  mockAttachRetryHeaders: vi.fn(),
  mockGetRetryAfterMs: vi.fn(),
  mockHasRateLimitEvidence: vi.fn(),
  mockIsRateLimitError: vi.fn(),
  mockResolveRetryDelayMs: vi.fn(),
  mockCreateRetryableHttpError: vi.fn(),
  mockIsRetryableError: vi.fn(),
  mockRetryWithExponentialBackoff: vi.fn(),
}

/**
 * Static mock module for `@/lib/knowledge/documents/utils`. `VALIDATE_RETRY_OPTIONS` carries the
 * real values.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/knowledge/documents/utils', () => knowledgeDocumentsUtilsMock)
 * ```
 */
export const knowledgeDocumentsUtilsMock = {
  VALIDATE_RETRY_OPTIONS: { maxRetries: 3, initialDelayMs: 1000, maxDelayMs: 10000 },
  readBoundedHttpErrorBody: knowledgeDocumentsUtilsMockFns.mockReadBoundedHttpErrorBody,
  readBoundedHttpErrorPayload: knowledgeDocumentsUtilsMockFns.mockReadBoundedHttpErrorPayload,
  attachRetryHeaders: knowledgeDocumentsUtilsMockFns.mockAttachRetryHeaders,
  getRetryAfterMs: knowledgeDocumentsUtilsMockFns.mockGetRetryAfterMs,
  hasRateLimitEvidence: knowledgeDocumentsUtilsMockFns.mockHasRateLimitEvidence,
  isRateLimitError: knowledgeDocumentsUtilsMockFns.mockIsRateLimitError,
  resolveRetryDelayMs: knowledgeDocumentsUtilsMockFns.mockResolveRetryDelayMs,
  createRetryableHttpError: knowledgeDocumentsUtilsMockFns.mockCreateRetryableHttpError,
  isRetryableError: knowledgeDocumentsUtilsMockFns.mockIsRetryableError,
  retryWithExponentialBackoff: knowledgeDocumentsUtilsMockFns.mockRetryWithExponentialBackoff,
}
