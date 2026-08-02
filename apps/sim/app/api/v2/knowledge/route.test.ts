/**
 * @vitest-environment node
 *
 * Public v2 knowledge-base list: the search/filter/sort convention reaching the
 * lib rather than being applied over its result.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckRateLimit, mockResolveWorkspaceAccess, mockGetKnowledgeBases } = vi.hoisted(
  () => ({
    mockCheckRateLimit: vi.fn(),
    mockResolveWorkspaceAccess: vi.fn(),
    mockGetKnowledgeBases: vi.fn(),
  })
)

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceAccess: mockResolveWorkspaceAccess,
}))

vi.mock('@/lib/knowledge/service', () => ({
  getKnowledgeBases: mockGetKnowledgeBases,
}))

vi.mock('@/lib/knowledge/orchestration', () => ({
  performCreateKnowledgeBase: vi.fn(),
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

import { GET } from '@/app/api/v2/knowledge/route'

const WS = 'workspace-1'
const FOLDER_ID = 'fold_1'

const RATE_LIMIT_OK = {
  allowed: true,
  userId: 'user-1',
  keyType: 'workspace',
  limit: 100,
  remaining: 99,
  resetAt: new Date('2024-01-01T01:00:00Z'),
}

/** What the route forwards for a bare `?workspaceId=` list. */
const DEFAULT_LIST_ARGS = {
  folderId: undefined,
  search: undefined,
  sortBy: 'createdAt',
  sortOrder: 'asc',
}

function buildKnowledgeBase(overrides: Record<string, unknown> = {}) {
  return {
    id: 'kb_1',
    userId: 'user-1',
    name: 'Support docs',
    description: null,
    tokenCount: 0,
    embeddingModel: 'text-embedding-3-small',
    embeddingDimension: 1536,
    chunkingConfig: { maxSize: 1024, minSize: 1, overlap: 200 },
    workspaceId: WS,
    folderId: null,
    docCount: 2,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-02T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  }
}

const callList = (query: string) =>
  GET(new NextRequest(`http://localhost:3000/api/v2/knowledge?${query}`))

describe('GET /api/v2/knowledge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockGetKnowledgeBases.mockResolvedValue([buildKnowledgeBase()])
  })

  it('forwards search, folder, and sort into the query rather than filtering the result', async () => {
    const res = await callList(
      `workspaceId=${WS}&search=support&folderId=${FOLDER_ID}&sortBy=name&sortOrder=desc`
    )

    expect(res.status).toBe(200)
    expect(mockGetKnowledgeBases).toHaveBeenCalledWith('user-1', WS, 'active', {
      folderId: FOLDER_ID,
      search: 'support',
      sortBy: 'name',
      sortOrder: 'desc',
    })
  })

  it('defaults to the createdAt ordering when no sort is requested', async () => {
    await callList(`workspaceId=${WS}`)

    expect(mockGetKnowledgeBases).toHaveBeenCalledWith('user-1', WS, 'active', DEFAULT_LIST_ARGS)
  })

  it('400s on a sort field outside the enum instead of letting it reach the query', async () => {
    const res = await callList(`workspaceId=${WS}&sortBy=name);--`)

    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
    expect(mockGetKnowledgeBases).not.toHaveBeenCalled()
  })

  it('400s on a sort direction outside the enum', async () => {
    const res = await callList(`workspaceId=${WS}&sortOrder=sideways`)

    expect(res.status).toBe(400)
    expect(mockGetKnowledgeBases).not.toHaveBeenCalled()
  })

  it('400s on an empty search rather than treating it as unsearched', async () => {
    const res = await callList(`workspaceId=${WS}&search=`)

    expect(res.status).toBe(400)
    expect(mockGetKnowledgeBases).not.toHaveBeenCalled()
  })

  it('terminates pagination with a filter applied', async () => {
    const res = await callList(`workspaceId=${WS}&search=support`)

    expect((await res.json()).nextCursor).toBeNull()
  })
})
