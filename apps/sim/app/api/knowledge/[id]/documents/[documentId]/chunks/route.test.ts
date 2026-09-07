/**
 * @vitest-environment node
 */

import { authMockFns, createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestRuntimePrincipal } from '@/lib/auth/runtime-principal.test-support'

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

import { internalKnowledgeSessionOrExecutorAuth } from '@/lib/knowledge/api/route-policies'
import { KnowledgeDocumentNotReadyError } from '@/lib/knowledge/application/chunk-errors'
import { GET, POST } from '@/app/api/knowledge/[id]/documents/[documentId]/chunks/route'

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

  it('passes the executor transport workspace into chunk reads', async () => {
    const principal = createTestRuntimePrincipal()
    vi.spyOn(
      internalKnowledgeSessionOrExecutorAuth,
      'authenticateWithTransport'
    ).mockResolvedValueOnce({
      principal,
      transport: 'executor_jwt',
      executionWorkspaceId: 'workspace-canonical',
    })
    mocks.list.mockResolvedValueOnce({
      chunks: [],
      pagination: { total: 0, limit: 50, offset: 0, hasMore: false },
      workspaceId: 'workspace-canonical',
      documentId: 'document-1',
    })

    const response = await GET(createMockRequest('GET'), params())

    expect(response.status).toBe(200)
    expect(mocks.list.mock.calls[0][0]).toMatchObject({
      principal,
      input: { assertedWorkspaceId: 'workspace-canonical' },
    })
  })

  it('passes the executor transport workspace into chunk writes', async () => {
    const principal = createTestRuntimePrincipal()
    vi.spyOn(
      internalKnowledgeSessionOrExecutorAuth,
      'authenticateWithTransport'
    ).mockResolvedValueOnce({
      principal,
      transport: 'executor_jwt',
      executionWorkspaceId: 'workspace-canonical',
    })
    mocks.create.mockRejectedValueOnce(new Error('stop after input mapping'))

    const response = await POST(
      createMockRequest('POST', { content: 'hello', enabled: true }),
      params()
    )

    expect(response.status).toBe(500)
    expect(mocks.create.mock.calls[0][0]).toMatchObject({
      principal,
      input: { assertedWorkspaceId: 'workspace-canonical' },
    })
  })
})
