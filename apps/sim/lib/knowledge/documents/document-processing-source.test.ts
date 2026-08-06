/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckActorUsageLimits,
  mockGenerateEmbeddings,
  mockGetBoundWorkspaceFileSecretProvenanceByMetadata,
  mockGetFileMetadataByKeys,
  mockProcessDocument,
} = vi.hoisted(() => ({
  mockCheckActorUsageLimits: vi.fn(),
  mockGenerateEmbeddings: vi.fn(),
  mockGetBoundWorkspaceFileSecretProvenanceByMetadata: vi.fn(),
  mockGetFileMetadataByKeys: vi.fn(),
  mockProcessDocument: vi.fn(),
}))

vi.mock('@/lib/billing/calculations/usage-monitor', () => ({
  checkActorUsageLimits: mockCheckActorUsageLimits,
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

import { processDocumentAsync } from '@/lib/knowledge/documents/service'

const PERSISTED_KEY = 'workspace/workspace-1/persisted.pdf'
const PERSISTED_URL = `/api/files/serve/${encodeURIComponent(PERSISTED_KEY)}?context=workspace`
const CONTENT_UPDATED_AT = new Date('2026-08-05T12:00:00.000Z')

const PERSISTED_CONTEXT = {
  workspaceId: null,
  knowledgeBaseUserId: 'knowledge-owner',
  chunkingConfig: null,
  embeddingModel: 'text-embedding-3-small',
  billedAccountUserId: null,
  uploadedBy: 'uploader-1',
  filename: 'persisted.pdf',
  fileUrl: PERSISTED_URL,
  fileSize: 512,
  mimeType: 'application/pdf',
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

const PERSISTED_PROVENANCE_ROW = {
  id: 'document-1',
  secretProvenanceVersion: null,
  filename: PERSISTED_CONTEXT.filename,
  fileUrl: PERSISTED_CONTEXT.fileUrl,
  contentHash: null,
  sourceUrl: null,
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
  provenanceSourceHash: null,
  status: null,
  entries: null,
}

const SOURCE_BINDING = {
  id: 'source-file-1',
  key: PERSISTED_KEY,
  userId: 'uploader-1',
  workspaceId: 'workspace-1',
  context: 'workspace',
  originalName: PERSISTED_CONTEXT.filename,
  displayName: PERSISTED_CONTEXT.filename,
  contentType: PERSISTED_CONTEXT.mimeType,
  size: PERSISTED_CONTEXT.fileSize,
  folderId: null,
  uploadedAt: CONTENT_UPDATED_AT,
  contentUpdatedAt: CONTENT_UPDATED_AT,
  deletedAt: null,
  secretProvenanceVersion: null,
}

describe('knowledge document processing source', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    dbChainMockFns.limit
      .mockResolvedValueOnce([PERSISTED_CONTEXT])
      .mockResolvedValueOnce([PERSISTED_PROVENANCE_ROW])
      .mockResolvedValueOnce([{ id: 'document-1' }])
    mockCheckActorUsageLimits.mockResolvedValue({ isExceeded: false })
    mockGetFileMetadataByKeys.mockImplementation(async (_keys: string[], context: string) =>
      context === 'workspace' ? [SOURCE_BINDING] : []
    )
    mockGetBoundWorkspaceFileSecretProvenanceByMetadata.mockResolvedValue(
      new Map([[SOURCE_BINDING.id, { status: 'exact', entries: [] }]])
    )
    mockProcessDocument.mockResolvedValue({
      chunks: [],
      metadata: { chunkCount: 0, tokenCount: 0, characterCount: 0 },
    })
  })

  it('uses the persisted document source instead of stale queued source fields', async () => {
    await processDocumentAsync('knowledge-base-1', 'document-1', {
      filename: 'stale.pdf',
      fileUrl: 'https://example.com/stale.pdf',
      fileSize: 1,
      mimeType: 'text/plain',
    })

    expect(mockGetFileMetadataByKeys).toHaveBeenCalledWith(
      [PERSISTED_KEY],
      'workspace',
      expect.anything()
    )
    expect(mockGetBoundWorkspaceFileSecretProvenanceByMetadata).toHaveBeenCalledWith(
      expect.anything(),
      [SOURCE_BINDING]
    )
    expect(mockProcessDocument).toHaveBeenCalledWith(
      PERSISTED_CONTEXT.fileUrl,
      PERSISTED_CONTEXT.filename,
      PERSISTED_CONTEXT.mimeType,
      1024,
      200,
      100,
      PERSISTED_CONTEXT.uploadedBy,
      null,
      undefined,
      undefined
    )
    expect(mockGenerateEmbeddings).not.toHaveBeenCalled()
  })

  it('processes a legacy document when its workspace metadata row no longer exists', async () => {
    mockGetFileMetadataByKeys.mockResolvedValue([])
    mockGetBoundWorkspaceFileSecretProvenanceByMetadata.mockResolvedValue(new Map())

    await processDocumentAsync('knowledge-base-1', 'document-1', {
      filename: 'stale.pdf',
      fileUrl: 'https://example.com/stale.pdf',
      fileSize: 1,
      mimeType: 'text/plain',
    })

    expect(mockProcessDocument).toHaveBeenCalledWith(
      PERSISTED_CONTEXT.fileUrl,
      PERSISTED_CONTEXT.filename,
      PERSISTED_CONTEXT.mimeType,
      1024,
      200,
      100,
      PERSISTED_CONTEXT.uploadedBy,
      null,
      undefined,
      undefined
    )
  })

  it('fails before parsing an existing document when its current source is tracked unknown', async () => {
    mockGetFileMetadataByKeys.mockImplementation(async (_keys: string[], context: string) =>
      context === 'workspace' ? [{ ...SOURCE_BINDING, secretProvenanceVersion: 1 }] : []
    )
    mockGetBoundWorkspaceFileSecretProvenanceByMetadata.mockResolvedValue(
      new Map([[SOURCE_BINDING.id, { status: 'unknown' }]])
    )

    await expect(
      processDocumentAsync('knowledge-base-1', 'document-1', {
        filename: 'stale.pdf',
        fileUrl: 'https://example.com/stale.pdf',
        fileSize: 1,
        mimeType: 'text/plain',
      })
    ).rejects.toThrow('Knowledge document secret provenance is unavailable')

    expect(mockProcessDocument).not.toHaveBeenCalled()
    expect(mockGenerateEmbeddings).not.toHaveBeenCalled()
  })
})
