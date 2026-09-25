import { vi } from 'vitest'

/**
 * Stand-in for the real `KnowledgeBaseFileOwnershipError` (`code: 'forbidden'`, carries
 * `storageKey`). NOT a subclass of the real `OrchestrationError`.
 */
export class MockKnowledgeBaseFileOwnershipError extends Error {
  readonly code = 'forbidden' as const

  constructor(readonly storageKey: string) {
    super('Document file is not owned by this knowledge base')
    this.name = 'KnowledgeBaseFileOwnershipError'
  }
}

/** Stand-in for the real `ConnectorSyncDeletionGuardError` (real name and message). */
export class MockConnectorSyncDeletionGuardError extends Error {
  constructor() {
    super('Connector sync no longer owns the destructive document operation')
    this.name = 'ConnectorSyncDeletionGuardError'
  }
}

/**
 * Controllable mock functions for `@/lib/knowledge/documents/service`.
 *
 * Defaults: `mockGetProcessingConfig` returns the real env-default config
 * (`{ maxConcurrentDocuments: 4, batchSize: 10, delayBetweenBatches: 200, delayBetweenDocuments: 100 }`).
 * Everything else is a bare `vi.fn()`.
 *
 * @example
 * ```ts
 * import { knowledgeDocumentsServiceMockFns } from '@sim/testing/mocks/knowledge-documents-service.mock'
 *
 * knowledgeDocumentsServiceMockFns.mockCreateSingleDocument.mockResolvedValue({ id: 'doc-1' })
 * ```
 */
export const knowledgeDocumentsServiceMockFns = {
  mockGetProcessingConfig: vi.fn(() => ({
    maxConcurrentDocuments: 4,
    batchSize: 10,
    delayBetweenBatches: 200,
    delayBetweenDocuments: 100,
  })),
  mockProcessDocumentsWithQueue: vi.fn(),
  mockProcessDocumentAsync: vi.fn(),
  mockCreateDocumentRecords: vi.fn(),
  mockGetDocuments: vi.fn(),
  mockGetKnowledgeDocument: vi.fn(),
  mockGetKnowledgeDocumentById: vi.fn(),
  mockCreateSingleDocument: vi.fn(),
  mockGetDocumentByUploadId: vi.fn(),
  mockBulkDocumentOperation: vi.fn(),
  mockBulkDocumentOperationByFilter: vi.fn(),
  mockMarkDocumentAsFailedTimeout: vi.fn(),
  mockRetryDocumentProcessing: vi.fn(),
  mockUpdateDocument: vi.fn(),
  mockDeleteDocumentStorageFiles: vi.fn(),
  mockHardDeleteDocuments: vi.fn(),
  mockDeleteDocument: vi.fn(),
  mockDeleteKnowledgeDocumentInKnowledgeBase: vi.fn(),
}

/**
 * Static mock module for `@/lib/knowledge/documents/service`. The error classes are
 * {@link MockKnowledgeBaseFileOwnershipError} and {@link MockConnectorSyncDeletionGuardError}.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/knowledge/documents/service', () => knowledgeDocumentsServiceMock)
 * ```
 */
export const knowledgeDocumentsServiceMock = {
  KnowledgeBaseFileOwnershipError: MockKnowledgeBaseFileOwnershipError,
  ConnectorSyncDeletionGuardError: MockConnectorSyncDeletionGuardError,
  getProcessingConfig: knowledgeDocumentsServiceMockFns.mockGetProcessingConfig,
  processDocumentsWithQueue: knowledgeDocumentsServiceMockFns.mockProcessDocumentsWithQueue,
  processDocumentAsync: knowledgeDocumentsServiceMockFns.mockProcessDocumentAsync,
  createDocumentRecords: knowledgeDocumentsServiceMockFns.mockCreateDocumentRecords,
  getDocuments: knowledgeDocumentsServiceMockFns.mockGetDocuments,
  getKnowledgeDocument: knowledgeDocumentsServiceMockFns.mockGetKnowledgeDocument,
  getKnowledgeDocumentById: knowledgeDocumentsServiceMockFns.mockGetKnowledgeDocumentById,
  createSingleDocument: knowledgeDocumentsServiceMockFns.mockCreateSingleDocument,
  getDocumentByUploadId: knowledgeDocumentsServiceMockFns.mockGetDocumentByUploadId,
  bulkDocumentOperation: knowledgeDocumentsServiceMockFns.mockBulkDocumentOperation,
  bulkDocumentOperationByFilter: knowledgeDocumentsServiceMockFns.mockBulkDocumentOperationByFilter,
  markDocumentAsFailedTimeout: knowledgeDocumentsServiceMockFns.mockMarkDocumentAsFailedTimeout,
  retryDocumentProcessing: knowledgeDocumentsServiceMockFns.mockRetryDocumentProcessing,
  updateDocument: knowledgeDocumentsServiceMockFns.mockUpdateDocument,
  deleteDocumentStorageFiles: knowledgeDocumentsServiceMockFns.mockDeleteDocumentStorageFiles,
  hardDeleteDocuments: knowledgeDocumentsServiceMockFns.mockHardDeleteDocuments,
  deleteDocument: knowledgeDocumentsServiceMockFns.mockDeleteDocument,
  deleteKnowledgeDocumentInKnowledgeBase:
    knowledgeDocumentsServiceMockFns.mockDeleteKnowledgeDocumentInKnowledgeBase,
}
