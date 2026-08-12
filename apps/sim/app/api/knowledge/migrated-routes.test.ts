/**
 * @vitest-environment node
 */
import { authMockFns, createMockRequest } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useCase: (id: string, execute: ReturnType<typeof vi.fn>) => ({ operation: { id }, execute }),
  listDocuments: vi.fn(),
  createDocuments: vi.fn(),
  bulkDocuments: vi.fn(),
  readDocument: vi.fn(),
  updateDocument: vi.fn(),
  deleteDocument: vi.fn(),
  upsertDocument: vi.fn(),
  listConnectors: vi.fn(),
  createConnector: vi.fn(),
  readConnector: vi.fn(),
  updateConnector: vi.fn(),
  deleteConnector: vi.fn(),
  syncConnector: vi.fn(),
  listConnectorDocuments: vi.fn(),
  updateConnectorDocuments: vi.fn(),
  search: vi.fn(),
  createUpload: vi.fn(),
  issueParts: vi.fn(),
  completeUpload: vi.fn(),
  cancelUpload: vi.fn(),
  persistedResponse: vi.fn(),
  provenanceResponse: vi.fn(),
  registryResponse: vi.fn(),
  resolveDocumentProvenance: vi.fn(),
  readKnowledgeBase: vi.fn(),
  updateKnowledgeBase: vi.fn(),
  deleteKnowledgeBase: vi.fn(),
  restoreKnowledgeBase: vi.fn(),
  platformUpload: vi.fn(),
  capture: vi.fn(),
}))

vi.mock('@/lib/knowledge/application/documents', () => ({
  listKnowledgeDocuments: mocks.useCase('knowledge.documents.list', mocks.listDocuments),
  createKnowledgeDocuments: mocks.useCase('knowledge.documents.upload', mocks.createDocuments),
  bulkUpdateKnowledgeDocuments: mocks.useCase('knowledge.documents.bulk', mocks.bulkDocuments),
  readKnowledgeDocument: mocks.useCase('knowledge.documents.read', mocks.readDocument),
  updateKnowledgeDocument: mocks.useCase('knowledge.documents.update', mocks.updateDocument),
  deleteKnowledgeDocument: mocks.useCase('knowledge.documents.delete', mocks.deleteDocument),
  upsertKnowledgeDocument: mocks.useCase('knowledge.documents.upload', mocks.upsertDocument),
}))

vi.mock('@/lib/knowledge/application/knowledge-bases', () => ({
  readInternalKnowledgeBase: mocks.useCase('knowledge.session.read', mocks.readKnowledgeBase),
  updateInternalKnowledgeBase: mocks.useCase('knowledge.session.update', mocks.updateKnowledgeBase),
  deleteInternalKnowledgeBase: mocks.useCase('knowledge.session.delete', mocks.deleteKnowledgeBase),
  restoreInternalKnowledgeBase: mocks.useCase(
    'knowledge.session.restore',
    mocks.restoreKnowledgeBase
  ),
}))

vi.mock('@/lib/knowledge/application/connectors', () => ({
  listKnowledgeConnectors: mocks.useCase('knowledge.connectors.list', mocks.listConnectors),
  createKnowledgeConnector: mocks.useCase('knowledge.connectors.create', mocks.createConnector),
  readKnowledgeConnector: mocks.useCase('knowledge.connectors.read', mocks.readConnector),
  updateKnowledgeConnector: mocks.useCase('knowledge.connectors.update', mocks.updateConnector),
  deleteKnowledgeConnector: mocks.useCase('knowledge.connectors.delete', mocks.deleteConnector),
  syncKnowledgeConnector: mocks.useCase('knowledge.connectors.sync', mocks.syncConnector),
  listKnowledgeConnectorDocuments: mocks.useCase(
    'knowledge.connectors.documents.list',
    mocks.listConnectorDocuments
  ),
  updateKnowledgeConnectorDocuments: mocks.useCase(
    'knowledge.connectors.documents.update',
    mocks.updateConnectorDocuments
  ),
}))

vi.mock('@/lib/knowledge/application/search', () => ({
  KnowledgeSearchProvenanceUnavailableError: class extends Error {},
  searchKnowledge: mocks.useCase('knowledge.search', mocks.search),
}))

vi.mock('@/lib/knowledge/application/upload-sessions', () => ({
  KnowledgeDocumentUnsupportedMediaTypeError: class extends Error {},
  createKnowledgeDocumentUpload: mocks.useCase(
    'knowledge.documents.upload.create',
    mocks.createUpload
  ),
  issueKnowledgeDocumentUploadParts: mocks.useCase(
    'knowledge.documents.upload.parts',
    mocks.issueParts
  ),
  completeKnowledgeDocumentUpload: mocks.useCase(
    'knowledge.documents.upload.complete',
    mocks.completeUpload
  ),
  cancelKnowledgeDocumentUpload: mocks.useCase(
    'knowledge.documents.upload.cancel',
    mocks.cancelUpload
  ),
}))

vi.mock('@/app/api/knowledge/secret-provenance', () => ({
  finalizeKnowledgePersistedResponse: mocks.persistedResponse,
  finalizeKnowledgeProvenanceResponse: mocks.provenanceResponse,
  finalizeKnowledgeRegistryResponse: mocks.registryResponse,
  resolveKnowledgeDocumentWriteSecretProvenance: mocks.resolveDocumentProvenance,
}))

vi.mock('@/lib/core/telemetry', () => ({
  PlatformEvents: { knowledgeBaseDocumentsUploaded: mocks.platformUpload },
}))

vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mocks.capture }))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { KnowledgeUsageLimitExceededError } from '@/lib/knowledge/application/billing'
import {
  GET as listConnectorDocuments,
  PATCH as updateConnectorDocuments,
} from '@/app/api/knowledge/[id]/connectors/[connectorId]/documents/route'
import { PUT as updateDocument } from '@/app/api/knowledge/[id]/documents/[documentId]/route'
import {
  PATCH as bulkDocuments,
  POST as createDocuments,
  GET as listDocuments,
} from '@/app/api/knowledge/[id]/documents/route'
import { POST as completeUpload } from '@/app/api/knowledge/[id]/documents/uploads/[uploadId]/complete/route'
import { POST as upsertDocument } from '@/app/api/knowledge/[id]/documents/upsert/route'
import { POST as restoreKnowledgeBase } from '@/app/api/knowledge/[id]/restore/route'
import {
  DELETE as deleteKnowledgeBase,
  GET as readKnowledgeBase,
  PUT as updateKnowledgeBase,
} from '@/app/api/knowledge/[id]/route'
import { POST as search } from '@/app/api/knowledge/search/route'

const session = {
  user: { id: 'user-1', email: 'user@example.com', name: 'User' },
  session: { id: 'session-1' },
}

const document = {
  id: 'document-1',
  knowledgeBaseId: 'knowledge-1',
  filename: 'guide.pdf',
  fileUrl: 'https://example.com/guide.pdf',
  fileSize: 42,
  mimeType: 'application/pdf',
  chunkCount: 1,
  tokenCount: 5,
  characterCount: 20,
  processingStatus: 'pending' as const,
  enabled: true,
  uploadedAt: new Date('2026-01-01T00:00:00Z'),
}

const knowledgeBase = {
  id: 'knowledge-1',
  userId: 'user-1',
  name: 'Docs',
  description: null,
  tokenCount: 0,
  embeddingModel: 'text-embedding-3-small',
  embeddingDimension: 1536,
  chunkingConfig: { maxSize: 1024, minSize: 100, overlap: 200 },
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  deletedAt: null,
  workspaceId: null,
  folderId: null,
  docCount: 0,
  connectorTypes: [],
}

describe('migrated internal Knowledge routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue(session)
    mocks.persistedResponse.mockResolvedValue({})
    mocks.provenanceResponse.mockResolvedValue({})
    mocks.registryResponse.mockReturnValue({})
    mocks.resolveDocumentProvenance.mockReturnValue({ success: true })
  })

  it('authenticates before parsing malformed document JSON', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce(null)
    const request = new NextRequest('http://localhost/api/knowledge/knowledge-1/documents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    })

    const response = await createDocuments(request, {
      params: Promise.resolve({ id: 'knowledge-1' }),
    })

    expect(response.status).toBe(401)
    expect(mocks.createDocuments).not.toHaveBeenCalled()
  })

  it('authenticates before parsing malformed knowledge base JSON', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce(null)
    const request = new NextRequest('http://localhost/api/knowledge/knowledge-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '{',
    })

    const response = await updateKnowledgeBase(request, {
      params: Promise.resolve({ id: 'knowledge-1' }),
    })

    expect(response.status).toBe(401)
    expect(mocks.updateKnowledgeBase).not.toHaveBeenCalled()
  })

  it('preserves knowledge base detail, delete, and restore envelopes', async () => {
    mocks.readKnowledgeBase.mockResolvedValue({ knowledgeBase })
    const readResponse = await readKnowledgeBase(createMockRequest('GET'), {
      params: Promise.resolve({ id: 'knowledge-1' }),
    })
    await expect(readResponse.json()).resolves.toEqual({
      success: true,
      data: expect.objectContaining({
        id: 'knowledge-1',
        workspaceId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    })

    mocks.deleteKnowledgeBase.mockResolvedValue({ success: true })
    const deleteResponse = await deleteKnowledgeBase(createMockRequest('DELETE'), {
      params: Promise.resolve({ id: 'knowledge-1' }),
    })
    await expect(deleteResponse.json()).resolves.toEqual({
      success: true,
      data: { message: 'Knowledge base deleted successfully' },
    })

    mocks.restoreKnowledgeBase.mockResolvedValue({ success: true })
    const restoreResponse = await restoreKnowledgeBase(createMockRequest('POST'), {
      params: Promise.resolve({ id: 'knowledge-1' }),
    })
    await expect(restoreResponse.json()).resolves.toEqual({ success: true })
  })

  it('renders unknown knowledge base failures safely', async () => {
    mocks.readKnowledgeBase.mockRejectedValue(new Error('postgres password=secret'))
    const response = await readKnowledgeBase(createMockRequest('GET'), {
      params: Promise.resolve({ id: 'knowledge-1' }),
    })

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Failed to fetch knowledge base' })
  })

  it('preserves the document-list envelope and canonical application input', async () => {
    mocks.listDocuments.mockResolvedValue({
      documents: [document],
      pagination: { total: 1, limit: 50, offset: 0, hasMore: false },
      workspaceId: 'workspace-1',
    })
    const request = createMockRequest(
      'GET',
      undefined,
      {},
      'http://localhost/api/knowledge/knowledge-1/documents?enabledFilter=all'
    )

    const response = await listDocuments(request, {
      params: Promise.resolve({ id: 'knowledge-1' }),
    })

    expect(mocks.listDocuments).toHaveBeenCalledWith({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: expect.objectContaining({ knowledgeBaseId: 'knowledge-1', enabledFilter: 'all' }),
      request,
    })
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        documents: [
          expect.objectContaining({ id: 'document-1', uploadedAt: '2026-01-01T00:00:00.000Z' }),
        ],
        pagination: { total: 1, limit: 50, offset: 0, hasMore: false },
      },
    })
  })

  it('renders unknown document failures safely', async () => {
    mocks.updateDocument.mockRejectedValue(new Error('postgres password=secret'))
    const response = await updateDocument(createMockRequest('PUT', { filename: 'renamed.pdf' }), {
      params: Promise.resolve({ id: 'knowledge-1', documentId: 'document-1' }),
    })

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to process knowledge document request',
    })
  })

  it('keeps document upsert admission behind auth and preserves its response', async () => {
    mocks.upsertDocument.mockResolvedValue({
      document: { documentId: 'document-2', filename: 'new.txt' },
      knowledgeBaseId: 'knowledge-1',
      isUpdate: false,
      previousDocumentId: null,
      processingConfig: { maxConcurrentDocuments: 5, batchSize: 10 },
      workspaceId: 'workspace-1',
      userId: 'user-1',
    })
    const response = await upsertDocument(
      createMockRequest('POST', {
        filename: 'new.txt',
        fileUrl: 'data:text/plain;base64,aGVsbG8=',
        fileSize: 5,
        mimeType: 'text/plain',
      }),
      { params: Promise.resolve({ id: 'knowledge-1' }) }
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: expect.objectContaining({
        documentsCreated: [{ documentId: 'document-2', filename: 'new.txt', status: 'pending' }],
        isUpdate: false,
        previousDocumentId: null,
        processingMethod: 'background',
      }),
    })
    expect(mocks.platformUpload).toHaveBeenCalledWith(
      expect.objectContaining({ knowledgeBaseId: 'knowledge-1', documentsCount: 1 })
    )
  })

  it('runs internal document analytics only after application success', async () => {
    mocks.createDocuments.mockResolvedValue({
      kind: 'single',
      data: document,
      workspaceId: 'workspace-1',
      userId: 'user-1',
    })
    const request = createMockRequest('POST', {
      bulk: false,
      filename: document.filename,
      fileUrl: document.fileUrl,
      fileSize: document.fileSize,
      mimeType: document.mimeType,
    })

    const response = await createDocuments(request, {
      params: Promise.resolve({ id: 'knowledge-1' }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { processingStatus: 'pending' },
    })
    expect(mocks.platformUpload).toHaveBeenCalledOnce()
    expect(mocks.capture).toHaveBeenCalledOnce()
    expect(mocks.createDocuments.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.platformUpload.mock.invocationCallOrder[0]
    )
  })

  it('preserves payment-required for document usage admission', async () => {
    mocks.createDocuments.mockRejectedValueOnce(
      new KnowledgeUsageLimitExceededError('Usage limit exceeded')
    )

    const response = await createDocuments(
      createMockRequest('POST', {
        bulk: false,
        filename: document.filename,
        fileUrl: document.fileUrl,
        fileSize: document.fileSize,
        mimeType: document.mimeType,
      }),
      { params: Promise.resolve({ id: 'knowledge-1' }) }
    )

    expect(response.status).toBe(402)
    await expect(response.json()).resolves.toEqual({ error: 'Usage limit exceeded' })
    expect(mocks.capture).not.toHaveBeenCalled()
  })

  it('returns not found when a bulk document selection has no active matches', async () => {
    mocks.bulkDocuments.mockRejectedValueOnce(
      new OrchestrationError('not_found', 'No valid documents found to update')
    )

    const response = await bulkDocuments(
      createMockRequest('PATCH', {
        operation: 'disable',
        documentIds: ['document-1'],
      }),
      { params: Promise.resolve({ id: 'knowledge-1' }) }
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: 'No valid documents found to update',
    })
  })

  it('rejects oversized document-create arrays at the contract boundary', async () => {
    const response = await createDocuments(
      createMockRequest('POST', {
        bulk: true,
        documents: Array.from({ length: 101 }, (_, index) => ({
          filename: `document-${index}.txt`,
          fileUrl: `https://example.com/document-${index}.txt`,
          fileSize: 1,
          mimeType: 'text/plain',
        })),
      }),
      { params: Promise.resolve({ id: 'knowledge-1' }) }
    )

    expect(response.status).toBe(400)
    expect(mocks.createDocuments).not.toHaveBeenCalled()
  })

  it('preserves connector-document list and mutation envelopes', async () => {
    mocks.listConnectorDocuments.mockResolvedValue({
      documents: [
        {
          id: 'document-1',
          filename: 'Guide',
          externalId: null,
          sourceUrl: null,
          enabled: true,
          userExcluded: false,
          uploadedAt: new Date('2026-01-01T00:00:00Z'),
          processingStatus: 'completed',
        },
      ],
      counts: { active: 1, excluded: 0 },
    })
    const params = Promise.resolve({ id: 'knowledge-1', connectorId: 'connector-1' })
    const listResponse = await listConnectorDocuments(
      new NextRequest(
        'http://localhost/api/knowledge/knowledge-1/connectors/connector-1/documents?includeExcluded=true&limit=25&offset=50'
      ),
      { params }
    )
    await expect(listResponse.json()).resolves.toEqual({
      success: true,
      data: {
        documents: [
          expect.objectContaining({ id: 'document-1', uploadedAt: '2026-01-01T00:00:00.000Z' }),
        ],
        counts: { active: 1, excluded: 0 },
      },
    })
    expect(mocks.listConnectorDocuments).toHaveBeenLastCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ includeExcluded: true, limit: 25, offset: 50 }),
      })
    )

    const filteredListResponse = await listConnectorDocuments(
      new NextRequest(
        'http://localhost/api/knowledge/knowledge-1/connectors/connector-1/documents?includeExcluded=false'
      ),
      { params: Promise.resolve({ id: 'knowledge-1', connectorId: 'connector-1' }) }
    )
    expect(filteredListResponse.status).toBe(200)
    expect(mocks.listConnectorDocuments).toHaveBeenLastCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ includeExcluded: false }),
      })
    )

    mocks.updateConnectorDocuments.mockResolvedValue({
      operation: 'exclude',
      count: 1,
      documentIds: ['document-1'],
    })
    const updateResponse = await updateConnectorDocuments(
      createMockRequest('PATCH', { operation: 'exclude', documentIds: ['document-1'] }),
      { params: Promise.resolve({ id: 'knowledge-1', connectorId: 'connector-1' }) }
    )
    await expect(updateResponse.json()).resolves.toEqual({
      success: true,
      data: { excludedCount: 1, documentIds: ['document-1'] },
    })
  })

  it('rejects oversized connector-document mutations at the contract boundary', async () => {
    const response = await updateConnectorDocuments(
      createMockRequest('PATCH', {
        operation: 'exclude',
        documentIds: Array.from({ length: 101 }, (_, index) => `document-${index}`),
      }),
      { params: Promise.resolve({ id: 'knowledge-1', connectorId: 'connector-1' }) }
    )

    expect(response.status).toBe(400)
    expect(mocks.updateConnectorDocuments).not.toHaveBeenCalled()
  })

  it('preserves search cost shape and sanitizes infrastructure errors', async () => {
    const registry = {}
    mocks.search.mockResolvedValue({
      results: [
        {
          embeddingId: 'embedding-1',
          documentId: 'document-1',
          documentName: 'Guide',
          sourceUrl: null,
          content: 'hello',
          chunkIndex: 0,
          metadata: {},
          similarity: 0.9,
        },
      ],
      query: 'hello',
      knowledgeBaseIds: ['knowledge-1'],
      knowledgeBaseId: 'knowledge-1',
      topK: 10,
      totalResults: 1,
      workspaceId: 'workspace-1',
      userId: 'user-1',
      resultSecretRegistry: registry,
      cost: {
        input: 0.1,
        output: 0,
        total: 0.1,
        tokens: { prompt: 1, completion: 0, total: 1 },
        model: 'text-embedding-3-small',
        pricing: { input: 0.1, output: 0 },
      },
    })
    const response = await search(
      createMockRequest('POST', {
        knowledgeBaseIds: ['knowledge-1'],
        query: 'hello',
      })
    )
    const body = await response.json()
    expect(body.data.results[0]).not.toHaveProperty('embeddingId')
    expect(body.data.cost).toEqual(expect.objectContaining({ total: 0.1 }))

    mocks.search.mockRejectedValueOnce(new Error('database host secret.internal'))
    const failure = await search(
      createMockRequest('POST', { knowledgeBaseIds: ['knowledge-1'], query: 'hello' })
    )
    expect(failure.status).toBe(500)
    await expect(failure.json()).resolves.toEqual({ error: 'Failed to perform vector search' })
  })

  it('runs upload analytics only after a newly-created completion', async () => {
    const completed = {
      session: {
        id: 'upload-1',
        knowledgeBaseId: 'knowledge-1',
        workspaceId: 'workspace-1',
        status: 'completed',
        uploadToken: 'token',
        objectKey: 'key',
        fileName: 'guide.pdf',
        contentType: 'application/pdf',
        fileSize: 42,
        expiresAt: new Date('2026-01-02T00:00:00Z'),
        error: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
      value: {
        created: true,
        document: {
          ...document,
          documentId: document.id,
        },
      },
      knowledgeBaseId: 'knowledge-1',
      workspaceId: 'workspace-1',
    }
    mocks.completeUpload.mockResolvedValue(completed)
    const response = await completeUpload(
      createMockRequest(
        'POST',
        undefined,
        { 'upload-token': 'token' },
        'http://localhost/api/knowledge/knowledge-1/documents/uploads/upload-1/complete?workspaceId=workspace-1'
      ),
      { params: Promise.resolve({ id: 'knowledge-1', uploadId: 'upload-1' }) }
    )

    expect(response.status).toBe(200)
    expect(mocks.capture).toHaveBeenCalledOnce()
    expect(mocks.platformUpload).toHaveBeenCalledOnce()
  })
})
