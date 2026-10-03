import {
  knowledgeDocumentsServiceMock,
  knowledgeDocumentsServiceMockFns,
} from '@sim/testing/mocks/knowledge-documents-service.mock'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  recordUndispatchedDocumentFailure: vi.fn(),
}))

vi.mock('@/lib/knowledge/documents/service', () => knowledgeDocumentsServiceMock)

vi.mock('@/lib/knowledge/documents/processing-claim', () => ({
  recordUndispatchedDocumentFailure: mocks.recordUndispatchedDocumentFailure,
}))

import { dispatchDocumentProcessing } from '@/lib/knowledge/documents/processing-dispatch'

const mockProcessDocumentsWithQueue = knowledgeDocumentsServiceMockFns.mockProcessDocumentsWithQueue

const DOCUMENTS = [
  {
    documentId: 'document-1',
    filename: 'one.txt',
    fileUrl: 'https://example.com/one.txt',
    fileSize: 3,
    mimeType: 'text/plain',
  },
  {
    documentId: 'document-2',
    filename: 'two.txt',
    fileUrl: 'https://example.com/two.txt',
    fileSize: 3,
    mimeType: 'text/plain',
  },
]

describe('dispatchDocumentProcessing', () => {
  it('records only documents whose returned dispatch outcome failed', async () => {
    mockProcessDocumentsWithQueue.mockResolvedValueOnce({
      requested: 2,
      accepted: 1,
      failed: 1,
      failedDocumentIds: ['document-2'],
    })

    await dispatchDocumentProcessing({
      documents: DOCUMENTS,
      knowledgeBaseId: 'knowledge-base-1',
      processingOptions: {},
      requestId: 'request-1',
      billingAttribution: undefined,
    })

    expect(mocks.recordUndispatchedDocumentFailure).toHaveBeenCalledTimes(1)
    expect(mocks.recordUndispatchedDocumentFailure).toHaveBeenCalledWith({
      documentId: 'document-2',
      knowledgeBaseId: 'knowledge-base-1',
      failureMessage: 'Document processing dispatch was not accepted',
      requestId: 'request-1',
    })
  })

  it('does not turn a partial failure-recording error into a total dispatch failure', async () => {
    mockProcessDocumentsWithQueue.mockResolvedValueOnce({
      requested: 2,
      accepted: 0,
      failed: 2,
      failedDocumentIds: ['document-1', 'document-2'],
    })
    mocks.recordUndispatchedDocumentFailure.mockRejectedValueOnce(new Error('database unavailable'))

    await expect(
      dispatchDocumentProcessing({
        documents: DOCUMENTS,
        knowledgeBaseId: 'knowledge-base-1',
        processingOptions: {},
        requestId: 'request-1',
        billingAttribution: undefined,
      })
    ).resolves.toBeUndefined()

    expect(mocks.recordUndispatchedDocumentFailure).toHaveBeenCalledTimes(2)
    expect(mocks.recordUndispatchedDocumentFailure).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ documentId: 'document-1' })
    )
    expect(mocks.recordUndispatchedDocumentFailure).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ documentId: 'document-2' })
    )
  })
})
