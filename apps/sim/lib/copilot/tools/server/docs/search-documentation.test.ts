/**
 * @vitest-environment node
 */
import { loggerMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGenerateSearchEmbedding } = vi.hoisted(() => ({
  mockGenerateSearchEmbedding: vi.fn(),
}))

vi.mock('@/lib/copilot/generated/tool-catalog-v1', () => ({
  SearchDocumentation: { id: 'search_documentation' },
}))
vi.mock('@/lib/knowledge/embeddings', () => ({
  generateSearchEmbedding: mockGenerateSearchEmbedding,
}))

import { searchDocumentationServerTool } from '@/lib/copilot/tools/server/docs/search-documentation'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

describe('documentation search model boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGenerateSearchEmbedding.mockResolvedValue({ embedding: [], isBYOK: false })
  })

  it('preserves a query that merely collides with ambient secret plaintext', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'DOCS_QUERY',
        plaintext: 'private documentation query',
        encryptedValue: 'encrypted-query',
      },
    ])
    registry.recordResolved('DOCS_QUERY', 'private documentation query')

    const result = await searchDocumentationServerTool.execute(
      { query: 'private documentation query' },
      { userId: 'user-1', resolvedSecretTraceRegistry: registry }
    )

    expect(mockGenerateSearchEmbedding).toHaveBeenCalledWith('private documentation query')
    expect(result).toEqual({
      results: [],
      query: 'private documentation query',
      totalResults: 0,
    })

    const logger = loggerMock.createLogger.mock.results.at(-1)?.value
    expect(logger?.info).toHaveBeenCalledWith('Executing docs search', {
      queryLength: 'private documentation query'.length,
      topK: 10,
    })
    expect(JSON.stringify(logger?.info.mock.calls)).not.toContain('private documentation query')
  })
})
