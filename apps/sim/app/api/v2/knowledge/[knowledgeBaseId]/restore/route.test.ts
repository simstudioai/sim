/**
 * @vitest-environment node
 */
import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRestore, mockGetUserEmails } = vi.hoisted(() => ({
  mockRestore: vi.fn(),
  mockGetUserEmails: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

vi.mock('@/lib/knowledge/application/knowledge-bases', () => ({
  restoreKnowledgeBase: { operation: { id: 'knowledge.restore' }, execute: mockRestore },
}))

vi.mock('@/lib/users/queries', () => ({
  getUserEmailsByIds: mockGetUserEmails,
  requireResolvedUserEmail: (map: Map<string, string>, userId: string) => {
    const email = map.get(userId)
    if (!email) throw new Error(`No email for ${userId}`)
    return email
  },
}))

import { NoWorkspaceAccessError } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { POST } from '@/app/api/v2/knowledge/[knowledgeBaseId]/restore/route'

const WORKSPACE_ID = 'workspace-1'
const context = { params: Promise.resolve({ knowledgeBaseId: 'kb-1' }) }

const RESTORED = {
  id: 'kb-1',
  userId: 'user-1',
  name: 'Docs',
  description: null,
  tokenCount: 12,
  embeddingModel: 'text-embedding-3-small',
  embeddingDimension: 1536,
  chunkingConfig: { maxSize: 1024, minSize: 100, overlap: 200 },
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-02-01T00:00:00Z'),
  deletedAt: null,
  workspaceId: WORKSPACE_ID,
  folderId: null,
  docCount: 3,
  connectorTypes: [],
}

function buildRequest(body: unknown = { workspaceId: WORKSPACE_ID }) {
  return new NextRequest('http://localhost/api/v2/knowledge/kb-1/restore', {
    method: 'POST',
    headers: { 'x-api-key': 'secret', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
  v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
  v2RouteMocks.authenticate.mockResolvedValue({
    principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
    rateLimitSubjectIds: ['api-key:key-1'],
    rateLimitSubscription: null,
    keyType: 'personal',
  })
  mockGetUserEmails.mockResolvedValue(new Map([['user-1', 'owner@example.com']]))
  mockRestore.mockResolvedValue({ knowledgeBase: RESTORED, folderPath: '/', restored: true })
})

describe('POST /api/v2/knowledge/[knowledgeBaseId]/restore', () => {
  it('returns the knowledge base as it now stands', async () => {
    const response = await POST(buildRequest(), context)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.id).toBe('kb-1')
    expect(body.data.folderPath).toBe('/')
    expect(mockRestore).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { knowledgeBaseId: 'kb-1', assertedWorkspaceId: WORKSPACE_ID, source: 'api' },
      })
    )
  })

  /**
   * Restoring twice must not read as a failure: the second call is the honest
   * answer to "make this active", and a 409 would make a retry after a dropped
   * response look like an error.
   */
  it('answers 200 for a knowledge base that is already active', async () => {
    mockRestore.mockResolvedValue({ knowledgeBase: RESTORED, folderPath: '/', restored: false })

    const response = await POST(buildRequest(), context)

    expect(response.status).toBe(200)
    expect((await response.json()).data.id).toBe('kb-1')
  })

  it('conceals a knowledge base in another tenant as not found', async () => {
    mockRestore.mockRejectedValue(new NoWorkspaceAccessError())

    const response = await POST(buildRequest(), context)

    expect(response.status).toBe(404)
    expect((await response.json()).error.message).toBe('Knowledge base not found')
  })

  it('reports an archived workspace as a conflict', async () => {
    mockRestore.mockRejectedValue(
      new OrchestrationError('conflict', 'Cannot restore knowledge base into an archived workspace')
    )

    const response = await POST(buildRequest(), context)

    expect(response.status).toBe(409)
  })

  it('rejects an unknown body key rather than dropping it', async () => {
    const response = await POST(buildRequest({ workspaceId: WORKSPACE_ID, force: true }), context)

    expect(response.status).toBe(400)
    expect(mockRestore).not.toHaveBeenCalled()
  })
})
