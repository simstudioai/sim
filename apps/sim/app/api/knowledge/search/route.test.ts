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
    mocks.search.mockResolvedValue({ results: [], knowledgeBases: [] })
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
    controller.abort()
    expect(call.input.signal.aborted).toBe(true)
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { query: 'Orion', results: [] },
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
