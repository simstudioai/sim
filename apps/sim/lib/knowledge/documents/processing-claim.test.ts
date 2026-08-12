/**
 * @vitest-environment node
 */

import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  KNOWLEDGE_DOCUMENT_PROCESSING_STALE_THRESHOLD_MS,
  reclaimStaleDocumentProcessingClaim,
} from '@/lib/knowledge/documents/processing-claim'

const NOW = new Date('2026-08-11T12:00:00.000Z')

describe('reclaimStaleDocumentProcessingClaim', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('leaves an active processing claim untouched', async () => {
    const reclaimed = await reclaimStaleDocumentProcessingClaim({
      knowledgeBaseId: 'knowledge-base-1',
      documentId: 'document-1',
      processingStartedAt: new Date(
        NOW.getTime() - KNOWLEDGE_DOCUMENT_PROCESSING_STALE_THRESHOLD_MS
      ),
      now: NOW,
    })

    expect(reclaimed).toBe(false)
    expect(dbChainMockFns.set).not.toHaveBeenCalled()
  })

  it.each([null, new Date(NOW.getTime() - KNOWLEDGE_DOCUMENT_PROCESSING_STALE_THRESHOLD_MS - 1)])(
    'reopens an abandoned processing claim started at %s',
    async (processingStartedAt) => {
      dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'document-1' }])

      const reclaimed = await reclaimStaleDocumentProcessingClaim({
        knowledgeBaseId: 'knowledge-base-1',
        documentId: 'document-1',
        processingStartedAt,
        now: NOW,
      })

      expect(reclaimed).toBe(true)
      expect(dbChainMockFns.set).toHaveBeenCalledWith({
        processingStatus: 'pending',
        processingStartedAt: null,
        processingCompletedAt: null,
        processingError: null,
      })
    }
  )

  it('does not report success when the original claim changed before the update', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])

    const reclaimed = await reclaimStaleDocumentProcessingClaim({
      knowledgeBaseId: 'knowledge-base-1',
      documentId: 'document-1',
      processingStartedAt: new Date(
        NOW.getTime() - KNOWLEDGE_DOCUMENT_PROCESSING_STALE_THRESHOLD_MS - 1
      ),
      now: NOW,
    })

    expect(reclaimed).toBe(false)
  })
})
