/**
 * @vitest-environment node
 */

import { embedding } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/knowledge/embeddings', () => ({
  generateEmbeddings: vi.fn(),
}))

vi.mock('@/lib/knowledge/embedding-models', () => ({
  getEmbeddingModelInfo: vi.fn(),
}))

vi.mock('@/lib/knowledge/secret-provenance', () => ({
  replaceKnowledgeEmbeddingSecretProvenanceInTx: vi.fn(),
}))

import { batchChunkOperation } from '@/lib/knowledge/chunks/service'

describe('batchChunkOperation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('reports the count of rows actually updated, not the count requested', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'chunk-1' }, { id: 'chunk-2' }])

    const result = await batchChunkOperation(
      'document-1',
      'disable',
      ['chunk-1', 'chunk-2', 'chunk-missing'],
      'request-1'
    )

    expect(result.processed).toBe(2)
    expect(result.errors).toEqual(['No matching chunks found to disable: chunk-missing'])
    expect(result.success).toBe(false)
  })

  it('reports zero processed when no requested chunk exists', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])

    const result = await batchChunkOperation(
      'document-1',
      'enable',
      ['missing-1', 'missing-2'],
      'request-2'
    )

    expect(result.processed).toBe(0)
    expect(result.errors).toEqual(['No matching chunks found to enable: missing-1, missing-2'])
    expect(result.success).toBe(false)
  })

  it('reports success with no errors when every requested chunk matched', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'chunk-1' }, { id: 'chunk-2' }])

    const result = await batchChunkOperation(
      'document-1',
      'enable',
      ['chunk-1', 'chunk-2'],
      'request-3'
    )

    expect(result).toEqual({ success: true, processed: 2, errors: [] })
  })

  /**
   * Delete used to answer differently from enable and disable: a partially
   * unmatched delete reported no error at all, and an entirely unmatched one
   * reported a generic message naming no id. Three rules behind one sentence of
   * documentation is what the contract could not describe honestly.
   */
  it('reports ids that name no chunk when deleting', async () => {
    queueTableRows(embedding, [{ id: 'chunk-1', tokenCount: 5, contentLength: 20 }])

    const result = await batchChunkOperation(
      'document-1',
      'delete',
      ['chunk-1', 'chunk-missing'],
      'request-4'
    )

    expect(result.processed).toBe(1)
    expect(result.errors).toEqual(['No matching chunks found to delete: chunk-missing'])
  })

  it('names the missing ids when no chunk matches a delete', async () => {
    queueTableRows(embedding, [])

    const result = await batchChunkOperation(
      'document-1',
      'delete',
      ['missing-1', 'missing-2'],
      'request-5'
    )

    expect(result.processed).toBe(0)
    expect(result.errors).toEqual(['No matching chunks found to delete: missing-1, missing-2'])
  })

  it('reports success with no errors when every requested chunk is deleted', async () => {
    queueTableRows(embedding, [{ id: 'chunk-1', tokenCount: 5, contentLength: 20 }])

    const result = await batchChunkOperation('document-1', 'delete', ['chunk-1'], 'request-6')

    expect(result).toEqual({ success: true, processed: 1, errors: [] })
  })
})
