/**
 * @vitest-environment node
 */

import { authMockFns, createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  bulk: vi.fn(),
}))

vi.mock('@/lib/knowledge/application/chunks', () => ({
  listKnowledgeChunks: {
    operation: { id: 'knowledge.chunks.list' },
    execute: mocks.list,
  },
  createKnowledgeChunk: {
    operation: { id: 'knowledge.chunks.create' },
    execute: mocks.create,
  },
  bulkUpdateKnowledgeChunks: {
    operation: { id: 'knowledge.chunks.bulk' },
    execute: mocks.bulk,
  },
}))

vi.mock('@/lib/knowledge/api/secret-provenance', () => ({
  finalizeKnowledgePersistedResponse: vi.fn(),
  finalizeKnowledgeProvenanceResponse: vi.fn(),
  resolveKnowledgeWriteSecretProvenance: vi.fn(),
}))

import { KnowledgeDocumentNotReadyError } from '@/lib/knowledge/application/chunk-errors'
import { GET } from '@/app/api/knowledge/[id]/documents/[documentId]/chunks/route'

const params = () => ({
  params: Promise.resolve({ id: 'knowledge-1', documentId: 'document-1' }),
})

describe('/api/knowledge/[id]/documents/[documentId]/chunks internal route composition', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1' },
    })
  })

  it('preserves retry metadata when a document is still processing', async () => {
    mocks.list.mockRejectedValueOnce(new KnowledgeDocumentNotReadyError('processing'))

    const response = await GET(createMockRequest('GET'), params())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Document is not ready for access',
      details: 'Document status: processing',
      retryAfter: 5,
    })
  })
})
