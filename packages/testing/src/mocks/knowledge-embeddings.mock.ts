import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/knowledge/embeddings`.
 *
 * Defaults: `mockGetConfiguredKbEmbedding` resolves the unconfigured-deployment default
 * `{ model: 'text-embedding-3-small', dimensions: 1536 }`. Everything else is a bare `vi.fn()`.
 *
 * @example
 * ```ts
 * import { knowledgeEmbeddingsMockFns } from '@sim/testing/mocks/knowledge-embeddings.mock'
 *
 * knowledgeEmbeddingsMockFns.mockGenerateSearchEmbedding.mockResolvedValue([0.1, 0.2])
 * ```
 */
export const knowledgeEmbeddingsMockFns = {
  mockGetConfiguredKbEmbedding: vi.fn(
    async (): Promise<{ model: string; dimensions: number }> => ({
      model: 'text-embedding-3-small',
      dimensions: 1536,
    })
  ),
  mockGenerateEmbeddings: vi.fn(),
  mockGenerateSearchEmbedding: vi.fn(),
  mockRecordSearchEmbeddingUsage: vi.fn(),
}

/**
 * Static mock module for `@/lib/knowledge/embeddings`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/knowledge/embeddings', () => knowledgeEmbeddingsMock)
 * ```
 */
export const knowledgeEmbeddingsMock = {
  getConfiguredKbEmbedding: knowledgeEmbeddingsMockFns.mockGetConfiguredKbEmbedding,
  generateEmbeddings: knowledgeEmbeddingsMockFns.mockGenerateEmbeddings,
  generateSearchEmbedding: knowledgeEmbeddingsMockFns.mockGenerateSearchEmbedding,
  recordSearchEmbeddingUsage: knowledgeEmbeddingsMockFns.mockRecordSearchEmbeddingUsage,
}
