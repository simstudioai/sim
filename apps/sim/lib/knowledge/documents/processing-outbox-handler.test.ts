/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getKnowledgeDocument: vi.fn(),
  processDocumentsWithQueue: vi.fn(),
  reclaimStaleDocumentProcessingClaim: vi.fn(),
}))

vi.mock('@/lib/knowledge/documents/service', () => ({
  getKnowledgeDocument: mocks.getKnowledgeDocument,
  processDocumentsWithQueue: mocks.processDocumentsWithQueue,
}))

vi.mock('@/lib/knowledge/documents/processing-claim', () => ({
  reclaimStaleDocumentProcessingClaim: mocks.reclaimStaleDocumentProcessingClaim,
}))

import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import type { OutboxEventContext } from '@/lib/core/outbox/service'
import { SYSTEM_ACCESS_SCOPE } from '@/lib/knowledge/access/types'
import { KNOWLEDGE_DOCUMENT_PROCESSING_OUTBOX_EVENT } from '@/lib/knowledge/documents/processing-outbox-event'
import { knowledgeDocumentProcessingOutboxHandlers } from '@/lib/knowledge/documents/processing-outbox-handler'

const BILLING_ATTRIBUTION = {
  actorUserId: 'user-1',
  workspaceId: 'workspace-1',
  organizationId: null,
  billedAccountUserId: 'owner-1',
  billingEntity: { type: 'user', id: 'owner-1' },
  billingPeriod: {
    start: '2026-08-01T00:00:00.000Z',
    end: '2026-09-01T00:00:00.000Z',
  },
  payerSubscription: null,
} satisfies BillingAttributionSnapshot

const DOCUMENT = {
  id: 'document-1',
  filename: 'guide.pdf',
  fileUrl: '/api/files/serve/kb%2Fguide.pdf?context=knowledge-base',
  fileSize: 128,
  mimeType: 'application/pdf',
  processingStatus: 'pending',
}

const PAYLOAD = {
  knowledgeBaseId: 'knowledge-base-1',
  documentId: 'document-1',
  processingOptions: { recipe: 'default', lang: 'en' },
  billingAttribution: BILLING_ATTRIBUTION,
}

function createContext(eventId = 'outbox-event-1'): OutboxEventContext {
  return {
    eventId,
    eventType: KNOWLEDGE_DOCUMENT_PROCESSING_OUTBOX_EVENT,
    attempts: 0,
    maxAttempts: 10,
    signal: new AbortController().signal,
    checkpointPayload: vi.fn(),
  }
}

function handler() {
  const value =
    knowledgeDocumentProcessingOutboxHandlers[KNOWLEDGE_DOCUMENT_PROCESSING_OUTBOX_EVENT]
  if (!value) throw new Error('Knowledge processing outbox handler is not registered')
  return value
}

describe('knowledge document processing outbox handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getKnowledgeDocument.mockResolvedValue(DOCUMENT)
    mocks.processDocumentsWithQueue.mockResolvedValue({
      requested: 1,
      accepted: 1,
      failed: 0,
      failedDocumentIds: [],
    })
    mocks.reclaimStaleDocumentProcessingClaim.mockResolvedValue(false)
  })

  it('gives initial in-process indexing the same lease-bound window as a continuation', async () => {
    const context = { ...createContext(), deadlineAt: Date.now() + 550_000 }
    await handler()(PAYLOAD, context)
    expect(handler().timeoutMs).toBe(550_000)
    expect(mocks.processDocumentsWithQueue.mock.calls[0][6]).toEqual({
      signal: context.signal,
      deadlineAt: context.deadlineAt,
    })
  })

  it('dispatches the authoritative document with the stable outbox event id', async () => {
    await handler()(PAYLOAD, createContext('outbox-event-stable'))

    expect(mocks.getKnowledgeDocument).toHaveBeenCalledWith(
      'knowledge-base-1',
      'document-1',
      SYSTEM_ACCESS_SCOPE
    )
    expect(mocks.processDocumentsWithQueue).toHaveBeenCalledWith(
      [
        {
          documentId: 'document-1',
          filename: 'guide.pdf',
          fileUrl: '/api/files/serve/kb%2Fguide.pdf?context=knowledge-base',
          fileSize: 128,
          mimeType: 'application/pdf',
        },
      ],
      'knowledge-base-1',
      { recipe: 'default', lang: 'en' },
      'outbox-event-stable',
      BILLING_ATTRIBUTION,
      undefined,
      { signal: expect.any(AbortSignal), deadlineAt: undefined }
    )
  })

  it.each([null, { ...DOCUMENT, processingStatus: 'completed' }])(
    'completes without redispatch when the document is absent or completed',
    async (document) => {
      mocks.getKnowledgeDocument.mockResolvedValueOnce(document)

      await handler()(PAYLOAD, createContext())

      expect(mocks.processDocumentsWithQueue).not.toHaveBeenCalled()
    }
  )

  it('keeps the event retryable while an earlier processing attempt is active', async () => {
    const processingStartedAt = new Date()
    mocks.getKnowledgeDocument.mockResolvedValueOnce({
      ...DOCUMENT,
      processingStatus: 'processing',
      processingStartedAt,
    })

    await expect(handler()(PAYLOAD, createContext())).rejects.toThrow(
      'Knowledge document document-1 is already being processed'
    )

    expect(mocks.reclaimStaleDocumentProcessingClaim).toHaveBeenCalledWith({
      knowledgeBaseId: 'knowledge-base-1',
      documentId: 'document-1',
      processingStartedAt,
    })
    expect(mocks.processDocumentsWithQueue).not.toHaveBeenCalled()
  })

  it('reclaims and redispatches an abandoned processing attempt', async () => {
    const processingStartedAt = new Date('2026-08-11T11:00:00.000Z')
    mocks.getKnowledgeDocument.mockResolvedValueOnce({
      ...DOCUMENT,
      processingStatus: 'processing',
      processingStartedAt,
    })
    mocks.reclaimStaleDocumentProcessingClaim.mockResolvedValueOnce(true)

    await handler()(PAYLOAD, createContext('outbox-event-retry'))

    expect(mocks.reclaimStaleDocumentProcessingClaim).toHaveBeenCalledWith({
      knowledgeBaseId: 'knowledge-base-1',
      documentId: 'document-1',
      processingStartedAt,
    })
    expect(mocks.processDocumentsWithQueue).toHaveBeenCalledWith(
      [
        {
          documentId: 'document-1',
          filename: 'guide.pdf',
          fileUrl: '/api/files/serve/kb%2Fguide.pdf?context=knowledge-base',
          fileSize: 128,
          mimeType: 'application/pdf',
        },
      ],
      'knowledge-base-1',
      { recipe: 'default', lang: 'en' },
      'outbox-event-retry',
      BILLING_ATTRIBUTION,
      undefined,
      { signal: expect.any(AbortSignal), deadlineAt: undefined }
    )
  })

  it('propagates dispatch failures so the outbox schedules a retry', async () => {
    const failure = new Error('queue unavailable')
    mocks.processDocumentsWithQueue.mockRejectedValueOnce(failure)

    await expect(handler()(PAYLOAD, createContext())).rejects.toBe(failure)
  })

  it('keeps the event retryable when dispatch returns a zero-acceptance failure', async () => {
    mocks.processDocumentsWithQueue.mockResolvedValueOnce({
      requested: 1,
      accepted: 0,
      failed: 1,
      failedDocumentIds: ['document-1'],
    })

    await expect(handler()(PAYLOAD, createContext())).rejects.toThrow(
      'processing dispatch was not accepted'
    )
  })

  it('fails fast on malformed durable processing options', async () => {
    await expect(
      handler()({ ...PAYLOAD, processingOptions: { unsupported: true } }, createContext())
    ).rejects.toThrow('unsupported processing options')

    expect(mocks.getKnowledgeDocument).not.toHaveBeenCalled()
  })
})
