/**
 * @vitest-environment node
 */

import { dbChainMockFns, hasMockCondition, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  failStaleDocumentProcessingClaim,
  failUndispatchedDocumentProcessing,
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

describe('failStaleDocumentProcessingClaim', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('rejects an active processing claim', async () => {
    await expect(
      failStaleDocumentProcessingClaim({
        documentId: 'document-1',
        processingStartedAt: new Date(
          NOW.getTime() - KNOWLEDGE_DOCUMENT_PROCESSING_STALE_THRESHOLD_MS
        ),
        now: NOW,
      })
    ).rejects.toThrow('Document has not been processing long enough to be considered dead')

    expect(dbChainMockFns.set).not.toHaveBeenCalled()
  })

  it('fails the exact abandoned processing claim', async () => {
    const processingStartedAt = new Date(
      NOW.getTime() - KNOWLEDGE_DOCUMENT_PROCESSING_STALE_THRESHOLD_MS - 1
    )
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'document-1' }])

    const result = await failStaleDocumentProcessingClaim({
      documentId: 'document-1',
      processingStartedAt,
      now: NOW,
    })

    expect(result).toEqual({
      success: true,
      processingDuration: KNOWLEDGE_DOCUMENT_PROCESSING_STALE_THRESHOLD_MS + 1,
    })
    expect(dbChainMockFns.set).toHaveBeenCalledWith({
      processingStatus: 'failed',
      processingError: 'Processing timed out. Please retry or re-sync the connector.',
      processingCompletedAt: NOW,
    })
  })

  it('does not fail a replacement processing claim', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])

    const result = await failStaleDocumentProcessingClaim({
      documentId: 'document-1',
      processingStartedAt: new Date(
        NOW.getTime() - KNOWLEDGE_DOCUMENT_PROCESSING_STALE_THRESHOLD_MS - 1
      ),
      now: NOW,
    })

    expect(result.success).toBe(false)
  })
})

describe('failUndispatchedDocumentProcessing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('fails the exact pending document', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'document-1' }])

    const failed = await failUndispatchedDocumentProcessing({
      documentId: 'document-1',
      knowledgeBaseId: 'knowledge-base-1',
      error: 'Failed to start processing',
      now: NOW,
    })

    expect(failed).toBe(true)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({
      processingStatus: 'failed',
      processingError: 'Failed to start processing',
      processingCompletedAt: NOW,
    })
  })

  /**
   * The dispatch may have been accepted and only its acknowledgement lost, so a
   * document a worker already claimed — or one already deleted — must survive
   * this write untouched.
   */
  it('scopes the write to a pending, undeleted document', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])

    const failed = await failUndispatchedDocumentProcessing({
      documentId: 'document-1',
      knowledgeBaseId: 'knowledge-base-1',
      error: 'Failed to start processing',
      now: NOW,
    })

    expect(failed).toBe(false)

    const where = dbChainMockFns.where.mock.calls[0]?.[0]
    expect(
      hasMockCondition(
        where,
        (node) =>
          node.type === 'eq' &&
          node.left === 'document.processingStatus' &&
          node.right === 'pending'
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        where,
        (node) => node.type === 'isNull' && node.column === 'document.deletedAt'
      )
    ).toBe(true)
  })
})
