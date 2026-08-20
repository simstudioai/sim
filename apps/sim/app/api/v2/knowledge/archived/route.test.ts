/**
 * @vitest-environment node
 */
import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2GateModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockListArchived, mockGetUserEmails } = vi.hoisted(() => ({
  mockListArchived: vi.fn(),
  mockGetUserEmails: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/app/api/v2/lib/gate', () => v2GateModuleMock)

vi.mock('@/lib/knowledge/application/knowledge-bases', () => ({
  listArchivedKnowledgeBases: {
    operation: { id: 'knowledge.list_archived' },
    execute: mockListArchived,
  },
}))

vi.mock('@/lib/users/queries', () => ({
  getUserEmailsByIds: mockGetUserEmails,
  requireResolvedUserEmail: (map: Map<string, string>, userId: string) => {
    const email = map.get(userId)
    if (!email) throw new Error(`No email for ${userId}`)
    return email
  },
}))

import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { GET } from '@/app/api/v2/knowledge/archived/route'

const WORKSPACE_ID = 'workspace-1'

const ARCHIVED = {
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
  deletedAt: new Date('2026-02-02T00:00:00Z'),
  workspaceId: WORKSPACE_ID,
  folderId: null,
  docCount: 3,
  connectorTypes: [],
}

function buildRequest(query = `?workspaceId=${WORKSPACE_ID}`) {
  return new NextRequest(`http://localhost/api/v2/knowledge/archived${query}`, {
    headers: { 'x-api-key': 'secret' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
  v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
  v2RouteMocks.gate.mockResolvedValue(null)
  v2RouteMocks.authenticate.mockResolvedValue({
    principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
    rolloutUserId: 'user-1',
    rateLimitSubjectIds: ['api-key:key-1'],
    rateLimitSubscription: null,
    keyType: 'personal',
  })
  mockGetUserEmails.mockResolvedValue(new Map([['user-1', 'owner@example.com']]))
  mockListArchived.mockResolvedValue({ knowledgeBases: [ARCHIVED], nextCursorKeys: null })
})

describe('GET /api/v2/knowledge/archived', () => {
  it('reports when each knowledge base was archived and omits its folder path', async () => {
    const response = await GET(buildRequest(), undefined)

    expect(response.status).toBe(200)
    const [item] = (await response.json()).data
    expect(item.deletedAt).toBe('2026-02-02T00:00:00.000Z')
    expect(item).not.toHaveProperty('folderPath')
    expect(item.ownerEmail).toBe('owner@example.com')
  })

  it('defaults to newest-archived-first, the order a trash bin reads in', async () => {
    await GET(buildRequest(), undefined)

    expect(mockListArchived).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ sortBy: 'updatedAt', sortOrder: 'desc' }),
      })
    )
  })

  it('pages with a cursor bound to the sort and filters', async () => {
    mockListArchived.mockResolvedValue({
      knowledgeBases: [ARCHIVED],
      nextCursorKeys: ['2026-02-01T00:00:00.000Z', 'kb-1'],
    })

    const nextCursor = (await (await GET(buildRequest(), undefined)).json()).nextCursor
    expect(typeof nextCursor).toBe('string')

    const refiltered = await GET(
      buildRequest(
        `?workspaceId=${WORKSPACE_ID}&search=docs&cursor=${encodeURIComponent(nextCursor)}`
      ),
      undefined
    )
    expect(refiltered.status).toBe(400)
  })

  it('rejects a folder filter it does not implement', async () => {
    const response = await GET(
      buildRequest(`?workspaceId=${WORKSPACE_ID}&folderPath=/Docs`),
      undefined
    )

    expect(response.status).toBe(400)
    expect(mockListArchived).not.toHaveBeenCalled()
  })

  /**
   * The archived read binds its own semantic operation rather than reaching the
   * active list through a `scope` param: a v2 route declares exactly one
   * operation, and the two reads are separately governable even where their
   * current policies agree.
   */
  it('binds its own semantic operation, reachable by every credential the active list is', () => {
    expect(knowledgeOperations.listArchived.id).toBe('knowledge.list_archived')
    expect(knowledgeOperations.list.id).toBe('knowledge.list')
    expect(knowledgeOperations.listArchived.workspaceApiKey).toBe('allow')
    expect(knowledgeOperations.list.workspaceApiKey).toBe('allow')
  })
})
