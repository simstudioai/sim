/**
 * @vitest-environment node
 */
import { document } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/knowledge/documents/document-processor', () => ({
  processDocument: vi.fn(),
}))

vi.mock('@/lib/knowledge/embedding-models', () => ({
  EMBEDDING_DIMENSIONS: 1536,
  getEmbeddingModelInfo: vi.fn(() => ({ tokenizerProvider: 'openai' })),
}))

vi.mock('@/lib/knowledge/embeddings', () => ({
  generateEmbeddings: vi.fn(),
}))

import { bulkDocumentOperation } from '@/lib/knowledge/documents/service'

const KNOWLEDGE_BASE_ID = 'knowledge-base-1'

describe('bulkDocumentOperation unmatched-id reporting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('reports an id that matched no updatable document without failing the request', async () => {
    queueTableRows(document, [{ id: 'document-1', enabled: true }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'document-1', enabled: false }])

    const result = await bulkDocumentOperation(
      KNOWLEDGE_BASE_ID,
      'disable',
      ['document-1', 'document-missing'],
      'request-1'
    )

    expect(result.successCount).toBe(1)
    expect(result.errors).toEqual(['No matching documents found to disable: document-missing'])
    expect(result.success).toBe(false)
  })

  it('answers a zero-match selection the same way, rather than throwing not-found', async () => {
    queueTableRows(document, [])

    const result = await bulkDocumentOperation(
      KNOWLEDGE_BASE_ID,
      'enable',
      ['missing-1', 'missing-2'],
      'request-2'
    )

    expect(result.successCount).toBe(0)
    expect(result.updatedDocuments).toEqual([])
    expect(result.errors).toEqual(['No matching documents found to enable: missing-1, missing-2'])
    expect(result.success).toBe(false)
  })

  it('reports no errors when every requested document matched', async () => {
    queueTableRows(document, [
      { id: 'document-1', enabled: false },
      { id: 'document-2', enabled: false },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([
      { id: 'document-1', enabled: true },
      { id: 'document-2', enabled: true },
    ])

    const result = await bulkDocumentOperation(
      KNOWLEDGE_BASE_ID,
      'enable',
      ['document-1', 'document-2'],
      'request-3'
    )

    expect(result.successCount).toBe(2)
    expect(result.errors).toEqual([])
    expect(result.success).toBe(true)
  })
})
