/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCalculateCost,
  mockCheckActorUsageLimits,
  mockGenerateEmbeddings,
  mockGetBoundWorkspaceFileSecretProvenanceByMetadata,
  mockGetFileMetadataByKeys,
  mockProcessDocument,
  mockRecordUsage,
} = vi.hoisted(() => ({
  mockCalculateCost: vi.fn(),
  mockCheckActorUsageLimits: vi.fn(),
  mockGenerateEmbeddings: vi.fn(),
  mockGetBoundWorkspaceFileSecretProvenanceByMetadata: vi.fn(),
  mockGetFileMetadataByKeys: vi.fn(),
  mockProcessDocument: vi.fn(),
  mockRecordUsage: vi.fn(),
}))

vi.mock('@/lib/billing/calculations/usage-monitor', () => ({
  checkActorUsageLimits: mockCheckActorUsageLimits,
}))

vi.mock('@/lib/billing/core/usage-log', () => ({
  recordUsage: mockRecordUsage,
}))

vi.mock('@/lib/billing/threshold-billing', () => ({
  checkAndBillOverageThreshold: vi.fn(),
  checkAndBillPayerOverageThreshold: vi.fn(),
}))

vi.mock('@/lib/knowledge/documents/document-processor', () => ({
  processDocument: mockProcessDocument,
}))

vi.mock('@/lib/knowledge/embedding-models', () => ({
  getEmbeddingModelInfo: vi.fn(() => ({ tokenizerProvider: 'openai' })),
}))

vi.mock('@/lib/knowledge/embeddings', () => ({
  generateEmbeddings: mockGenerateEmbeddings,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  getBoundWorkspaceFileSecretProvenanceByMetadata:
    mockGetBoundWorkspaceFileSecretProvenanceByMetadata,
}))

vi.mock('@/lib/uploads/core/storage-service', () => ({
  deleteFile: vi.fn(),
}))

vi.mock('@/lib/uploads/server/metadata', () => ({
  deleteFileMetadataByIdentity: vi.fn(),
  getFileMetadataByKeys: mockGetFileMetadataByKeys,
}))

vi.mock('@/providers/utils', () => ({
  calculateCost: mockCalculateCost,
}))

import { processDocumentAsync } from '@/lib/knowledge/documents/service'

const DOCUMENT_ID = 'document-1'
const KNOWLEDGE_BASE_ID = 'knowledge-base-1'
const PERSISTED_KEY = 'workspace/workspace-1/scan.pdf'
const PERSISTED_URL = `/api/files/serve/${encodeURIComponent(PERSISTED_KEY)}?context=workspace`

const EMPTY_TAGS = {
  tag1: null,
  tag2: null,
  tag3: null,
  tag4: null,
  tag5: null,
  tag6: null,
  tag7: null,
  number1: null,
  number2: null,
  number3: null,
  number4: null,
  number5: null,
  date1: null,
  date2: null,
  boolean1: null,
  boolean2: null,
  boolean3: null,
}

const PERSISTED_CONTEXT = {
  workspaceId: null,
  knowledgeBaseUserId: 'knowledge-owner',
  chunkingConfig: null,
  embeddingModel: 'text-embedding-3-small',
  billedAccountUserId: null,
  uploadedBy: 'uploader-1',
  filename: 'scan.pdf',
  fileUrl: PERSISTED_URL,
  fileSize: 512,
  mimeType: 'application/pdf',
  ...EMPTY_TAGS,
}

const PERSISTED_PROVENANCE_ROW = {
  id: DOCUMENT_ID,
  secretProvenanceVersion: null,
  filename: PERSISTED_CONTEXT.filename,
  fileUrl: PERSISTED_CONTEXT.fileUrl,
  contentHash: null,
  sourceUrl: null,
  ...EMPTY_TAGS,
  provenanceSourceHash: null,
  status: null,
  entries: null,
}

const DOC_DATA = {
  filename: PERSISTED_CONTEXT.filename,
  fileUrl: PERSISTED_CONTEXT.fileUrl,
  fileSize: PERSISTED_CONTEXT.fileSize,
  mimeType: PERSISTED_CONTEXT.mimeType,
}

/** Re-arms the row sets one `processDocumentAsync` call consumes. */
function armDocumentReads(): void {
  dbChainMockFns.limit
    .mockResolvedValueOnce([PERSISTED_CONTEXT])
    .mockResolvedValueOnce([PERSISTED_PROVENANCE_ROW])
    .mockResolvedValueOnce([{ id: DOCUMENT_ID }])
}

/** The update payload of the pass that marked the document completed. */
function completionUpdate(): Record<string, unknown> | undefined {
  return dbChainMockFns.set.mock.calls
    .map((call) => call[0] as Record<string, unknown>)
    .find((payload) => payload.processingStatus === 'completed')
}

describe('knowledge document extraction method', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    dbChainMockFns.returning.mockResolvedValue([{ id: DOCUMENT_ID }])
    mockCheckActorUsageLimits.mockResolvedValue({ isExceeded: false })
    mockGetFileMetadataByKeys.mockResolvedValue([])
    mockGetBoundWorkspaceFileSecretProvenanceByMetadata.mockResolvedValue(new Map())
    mockGenerateEmbeddings.mockResolvedValue({
      embeddings: [[0.1, 0.2]],
      billableTokens: 128,
      modelName: 'text-embedding-3-small',
      pricingId: 'text-embedding-3-small',
    })
    mockCalculateCost.mockReturnValue({ total: 0 })
  })

  it.each(['mistral-ocr', 'file-parser'] as const)(
    'persists %s as the extraction method alongside the counts it qualifies',
    async (processingMethod) => {
      mockProcessDocument.mockResolvedValue({
        chunks: [{ text: 'chunk text', metadata: { startIndex: 0, endIndex: 10 } }],
        metadata: { chunkCount: 1, tokenCount: 4, characterCount: 10, processingMethod },
      })
      armDocumentReads()

      await processDocumentAsync(KNOWLEDGE_BASE_ID, DOCUMENT_ID, DOC_DATA, {})

      expect(completionUpdate()).toMatchObject({
        characterCount: 10,
        extractionMethod: processingMethod,
      })
    }
  )
})
