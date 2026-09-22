/**
 * @vitest-environment node
 */
import { authMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ search: vi.fn() }))
vi.mock('@/lib/knowledge/application/workspace-search', () => ({
  searchScopedKnowledge: { operation: { id: 'knowledge.search' }, execute: mocks.search },
}))

import { POST } from '@/app/api/knowledge/search/route'

describe('workspace search route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-1', email: 'reader@fixture.test', name: 'Reader' },
      session: { id: 'session-1' },
    })
    mocks.search.mockResolvedValue({
      results: [],
      knowledgeBases: [],
      retrieval: { status: 'complete', timedOutLegs: [] },
    })
  })

  it('passes the authenticated request cancellation signal through the existing operation', async () => {
    const controller = new AbortController()
    const request = new NextRequest('http://localhost/api/knowledge/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workspaceId: 'workspace-1',
        filters: { source: 'slack', documentIds: ['doc-1'] },
        query: 'Orion',
      }),
      signal: controller.signal,
    })
    const response = await POST(request)
    expect(response.status).toBe(200)
    const call = mocks.search.mock.calls[0][0]
    expect(call.principal).toEqual({ kind: 'session', userId: 'user-1', sessionId: 'session-1' })
    expect(call.input).not.toHaveProperty('knowledgeBaseIds')
    expect(call.input.filters).toEqual({ source: 'slack', documentIds: ['doc-1'] })
    expect(call.input.signal).toBe(request.signal)
    expect(call.input.allowPartialResults).toBe(true)
    expect(call.input.vectorBudgetMs).toBe(3000)
    /** A person's search asks for reranking; the use case reranks when a credential exists. */
    expect(call.input.rerankerEnabled).toBe(true)
    expect(call.input.rerankerModel).toBe('rerank-v4.0-fast')
    controller.abort()
    expect(call.input.signal.aborted).toBe(true)
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { query: 'Orion', results: [], retrieval: { status: 'complete', timedOutLegs: [] } },
    })
  })

  it('preserves usable matches and incomplete coverage when one retrieval leg times out', async () => {
    mocks.search.mockResolvedValueOnce({
      knowledgeBases: [{ id: 'knowledge-1', name: 'Search index' }],
      retrieval: { status: 'partial', timedOutLegs: ['vector'] },
      results: [
        {
          documentId: 'document-1',
          knowledgeBaseId: 'knowledge-1',
          documentName: 'Release plan',
          sourceUrl: null,
          connectorType: null,
          sourceModifiedAt: null,
          metadata: {},
          content: 'Orion release',
          chunkIndex: 0,
          similarity: 0.9,
        },
      ],
    })
    const response = await POST(
      new NextRequest('http://localhost/api/knowledge/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId: 'organization-1', query: 'Orion' }),
      })
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        results: [{ documentId: 'document-1', content: 'Orion release' }],
        retrieval: { status: 'partial', timedOutLegs: ['vector'] },
      },
    })
  })

  it('authenticates before parsing and never enters search for an anonymous request', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce(null)
    const response = await POST(
      new NextRequest('http://localhost/api/knowledge/search', {
        method: 'POST',
        body: '{',
        headers: { 'content-type': 'application/json' },
      })
    )
    expect(response.status).toBe(401)
    expect(mocks.search).not.toHaveBeenCalled()
  })
})
