/**
 * @vitest-environment node
 *
 * Lock-order regression guard: `updateDocument` must lock the document's
 * embedding rows BEFORE the document row when cascading tag updates, matching
 * the embedding → document order every chunk-mutation path uses
 * (chunks/service.ts). The opposite order deadlocks a document tag edit against
 * a concurrent chunk edit of the same document.
 */
import { document, embedding } from '@sim/db/schema'
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { updateDocument } from '@/lib/knowledge/documents/service'

vi.mock('@sim/db', () => dbChainMock)

/** invocationCallOrder of the first `tx.update(table)` call. */
function updateOrderForTable(table: unknown): number {
  const { calls, invocationCallOrder } = dbChainMockFns.update.mock
  for (let i = 0; i < calls.length; i++) {
    if (calls[i][0] === table) return invocationCallOrder[i]
  }
  return -1
}

describe('updateDocument lock ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    // Post-transaction re-read of the updated document must return a row.
    dbChainMockFns.limit.mockResolvedValue([{ id: 'doc-1', knowledgeBaseId: 'kb-1' }])
  })

  it('updates embeddings before the document row when cascading tag changes', async () => {
    await updateDocument('doc-1', { tag1: 'priority' }, 'req-1')

    const embeddingWriteOrder = updateOrderForTable(embedding)
    const documentWriteOrder = updateOrderForTable(document)

    expect(embeddingWriteOrder).toBeGreaterThan(0)
    expect(documentWriteOrder).toBeGreaterThan(0)
    expect(embeddingWriteOrder).toBeLessThan(documentWriteOrder)
  })
})
