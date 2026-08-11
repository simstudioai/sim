/**
 * @vitest-environment node
 */
import { authMockFns, createMockRequest } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  platformCreated: vi.fn(),
  capture: vi.fn(),
}))

vi.mock('@/lib/knowledge/application/knowledge-bases', () => ({
  listInternalKnowledgeBases: {
    operation: { id: 'knowledge.session.list' },
    execute: mocks.list,
  },
  createKnowledgeBase: {
    operation: { id: 'knowledge.create' },
    execute: mocks.create,
  },
}))

vi.mock('@/lib/core/telemetry', () => ({
  PlatformEvents: { knowledgeBaseCreated: mocks.platformCreated },
}))

vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mocks.capture }))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { GET, POST } from '@/app/api/knowledge/route'

const session = {
  user: { id: 'user-123', email: 'test@example.com', name: 'Test User' },
  session: { id: 'session-123' },
}

const knowledgeBase = {
  id: 'knowledge-1',
  userId: 'user-123',
  name: 'Test Knowledge Base',
  description: 'Test description',
  tokenCount: 0,
  embeddingModel: 'text-embedding-3-small',
  embeddingDimension: 1536,
  chunkingConfig: { maxSize: 1024, minSize: 100, overlap: 200 },
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
  deletedAt: null,
  workspaceId: 'workspace-1',
  folderId: null,
  docCount: 0,
  connectorTypes: [],
}

const expectedKnowledgeBase = {
  ...knowledgeBase,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
}

describe('/api/knowledge internal route composition', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue(session)
    mocks.list.mockResolvedValue({ knowledgeBases: [knowledgeBase] })
    mocks.create.mockResolvedValue({ knowledgeBase, folderPath: '/' })
  })

  it('authenticates before parsing malformed JSON', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce(null)
    const request = new NextRequest('http://localhost/api/knowledge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    })

    const response = await POST(request)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('preserves the legacy personal listing envelope without inventing a workspace', async () => {
    const request = createMockRequest(
      'GET',
      undefined,
      {},
      'http://localhost/api/knowledge?scope=all'
    )

    const response = await GET(request)

    expect(mocks.list).toHaveBeenCalledWith({
      principal: { kind: 'session', userId: 'user-123', sessionId: 'session-123' },
      input: { workspaceId: undefined, scope: 'all' },
      request,
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: [expectedKnowledgeBase],
    })
  })

  it('preserves workspace-scoped archived listing input and envelope', async () => {
    const request = createMockRequest(
      'GET',
      undefined,
      {},
      'http://localhost/api/knowledge?workspaceId=workspace-1&scope=archived'
    )

    const response = await GET(request)

    expect(mocks.list).toHaveBeenCalledWith({
      principal: { kind: 'session', userId: 'user-123', sessionId: 'session-123' },
      input: { workspaceId: 'workspace-1', scope: 'archived' },
      request,
    })
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: [expectedKnowledgeBase],
    })
  })

  it('preserves the legacy query validation envelope', async () => {
    const response = await GET(
      createMockRequest('GET', undefined, {}, 'http://localhost/api/knowledge?scope=invalid')
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({
      error: 'Invalid query parameters',
      details: expect.any(Array),
    })
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('preserves the exact creation envelope and runs internal analytics after success', async () => {
    const request = createMockRequest('POST', {
      name: 'Test Knowledge Base',
      description: 'Test description',
      workspaceId: 'workspace-1',
      folderId: null,
    })

    const response = await POST(request)

    expect(mocks.create).toHaveBeenCalledWith({
      principal: { kind: 'session', userId: 'user-123', sessionId: 'session-123' },
      input: {
        workspaceId: 'workspace-1',
        name: 'Test Knowledge Base',
        description: 'Test description',
        folderId: null,
        chunkingConfig: { maxSize: 1024, minSize: 100, overlap: 200 },
        source: 'ui',
      },
      request,
    })
    expect(mocks.platformCreated).toHaveBeenCalledWith({
      knowledgeBaseId: 'knowledge-1',
      name: 'Test Knowledge Base',
      workspaceId: 'workspace-1',
    })
    expect(mocks.capture).toHaveBeenCalledWith(
      'user-123',
      'knowledge_base_created',
      {
        knowledge_base_id: 'knowledge-1',
        workspace_id: 'workspace-1',
        name: 'Test Knowledge Base',
      },
      {
        groups: { workspace: 'workspace-1' },
        setOnce: { first_kb_created_at: expect.any(String) },
      }
    )
    expect(mocks.create.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.platformCreated.mock.invocationCallOrder[0]
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: expectedKnowledgeBase,
    })
  })

  it('preserves the legacy body validation envelope', async () => {
    const response = await POST(createMockRequest('POST', { description: 'Missing fields' }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({ error: 'Invalid request data', details: expect.any(Array) })
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('projects typed application errors without running analytics', async () => {
    mocks.create.mockRejectedValueOnce(new OrchestrationError('conflict', 'Already exists'))

    const response = await POST(
      createMockRequest('POST', {
        name: 'Test Knowledge Base',
        workspaceId: 'workspace-1',
      })
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'Already exists' })
    expect(mocks.platformCreated).not.toHaveBeenCalled()
    expect(mocks.capture).not.toHaveBeenCalled()
  })

  it('returns a safe list error for unknown infrastructure failures', async () => {
    mocks.list.mockRejectedValueOnce(new Error('database DSN secret'))

    const response = await GET(createMockRequest('GET'))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Failed to fetch knowledge bases' })
  })
})
