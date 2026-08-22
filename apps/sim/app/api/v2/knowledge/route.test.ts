/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAuthenticate,
  mockCheckPreAuth,
  mockCheckRateLimit,
  mockList,
  mockCreate,
  mockPlatformCreated,
  mockCapture,
  mockGetUserEmailsByIds,
} = vi.hoisted(() => ({
  mockAuthenticate: vi.fn(),
  mockCheckPreAuth: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockList: vi.fn(),
  mockCreate: vi.fn(),
  mockPlatformCreated: vi.fn(),
  mockCapture: vi.fn(),
  mockGetUserEmailsByIds: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => ({
  authenticateV2ApiKey: mockAuthenticate,
  V2ApiKeyUnauthenticatedError: class V2ApiKeyUnauthenticatedError extends Error {},
}))

vi.mock('@/lib/core/rate-limiter', () => ({
  getRateLimit: () => ({ maxTokens: 100, refillRate: 100, refillIntervalMs: 60_000 }),
  RateLimiter: class RateLimiter {
    checkRateLimitDirect(...args: unknown[]) {
      return mockCheckPreAuth(...args)
    }

    checkRateLimitDirectOrThrow(...args: unknown[]) {
      return mockCheckRateLimit(...args)
    }
  },
}))

vi.mock('@/app/api/v2/lib/gate', () => ({ v2ApiGateError: vi.fn().mockResolvedValue(null) }))

vi.mock('@/lib/knowledge/application/knowledge-bases', () => ({
  listKnowledgeBases: { operation: { id: 'knowledge.list' }, execute: mockList },
  createKnowledgeBase: { operation: { id: 'knowledge.create' }, execute: mockCreate },
}))

vi.mock('@/lib/core/telemetry', () => ({
  PlatformEvents: { knowledgeBaseCreated: mockPlatformCreated },
}))

vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mockCapture }))
vi.mock('@/lib/users/queries', () => ({
  getUserEmailsByIds: mockGetUserEmailsByIds,
  requireResolvedUserEmail: (emails: Map<string, string>, userId: string) => emails.get(userId)!,
}))

import { V2_DEFAULT_PAGE_SIZE } from '@/lib/api/contracts/v2/shared'
import { REFILTERED_CURSOR_MESSAGE } from '@/lib/api/cursor-binding'
import { GET, POST } from '@/app/api/v2/knowledge/route'

const WORKSPACE_ID = 'workspace-1'
const RATE_LIMIT_OK = {
  allowed: true,
  remaining: 99,
  resetAt: new Date('2024-01-01T01:00:00Z'),
  retryAfterMs: 0,
}

function buildKnowledgeBase() {
  return {
    id: 'kb-1',
    userId: 'user-1',
    name: 'Support docs',
    description: null,
    tokenCount: 0,
    embeddingModel: 'text-embedding-3-small',
    embeddingDimension: 1536,
    chunkingConfig: { maxSize: 1024, minSize: 100, overlap: 200 },
    workspaceId: WORKSPACE_ID,
    folderId: null,
    docCount: 2,
    connectorTypes: ['notion'],
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-02T00:00:00Z'),
    deletedAt: null,
  }
}

describe('/api/v2/knowledge route composition', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckPreAuth.mockResolvedValue(RATE_LIMIT_OK)
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockAuthenticate.mockResolvedValue({
      principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
      rolloutUserId: 'user-1',
      rateLimitSubjectIds: ['api-key:key-1', 'user:user-1'],
      rateLimitSubscription: null,
      keyType: 'personal',
    })
    mockGetUserEmailsByIds.mockResolvedValue(new Map([['user-1', 'owner@example.com']]))
    mockList.mockResolvedValue({
      knowledgeBases: [{ knowledgeBase: buildKnowledgeBase(), folderPath: '/' }],
      nextCursorKeys: null,
      sortBy: 'name',
      sortOrder: 'desc',
    })
    mockCreate.mockResolvedValue({ knowledgeBase: buildKnowledgeBase(), folderPath: '/' })
  })

  it('delegates the bounded list query with the authenticated principal', async () => {
    const request = new NextRequest(
      `http://localhost/api/v2/knowledge?workspaceId=${WORKSPACE_ID}&search=support&folderPath=%2F&sortBy=name&sortOrder=desc`,
      { headers: { 'x-api-key': 'secret' } }
    )

    const response = await GET(request)

    expect(response.status).toBe(200)
    expect(mockList).toHaveBeenCalledWith({
      principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
      input: {
        workspaceId: WORKSPACE_ID,
        folderPath: '/',
        search: 'support',
        sortBy: 'name',
        sortOrder: 'desc',
        limit: V2_DEFAULT_PAGE_SIZE,
        cursorKeys: undefined,
      },
      request,
    })
    expect(await response.json()).toEqual({
      data: [
        expect.objectContaining({
          id: 'kb-1',
          folderPath: '/',
          ownerEmail: 'owner@example.com',
          connectorTypes: ['notion'],
          createdAt: '2024-01-01T00:00:00.000Z',
        }),
      ],
      nextCursor: null,
    })
  })

  /**
   * Pins the binding end-to-end — the mint in `present` and the read in
   * `mapInput` — because the contract-level sweep only checks a hand-maintained
   * map of param names and stays green when a route drops the stamp entirely.
   */
  it('refuses a cursor minted under a different filter', async () => {
    mockList.mockResolvedValue({
      knowledgeBases: [{ knowledgeBase: buildKnowledgeBase(), folderPath: '/' }],
      nextCursorKeys: ['Support docs', 'kb-1'],
      sortBy: 'name',
      sortOrder: 'desc',
    })

    const minted = await GET(
      new NextRequest(
        `http://localhost/api/v2/knowledge?workspaceId=${WORKSPACE_ID}&search=support`,
        { headers: { 'x-api-key': 'secret' } }
      )
    )
    const { nextCursor } = await minted.json()
    expect(nextCursor).toEqual(expect.any(String))

    mockList.mockClear()
    const replayed = await GET(
      new NextRequest(
        `http://localhost/api/v2/knowledge?workspaceId=${WORKSPACE_ID}&search=billing&cursor=${encodeURIComponent(nextCursor)}`,
        { headers: { 'x-api-key': 'secret' } }
      )
    )

    expect(replayed.status).toBe(400)
    expect((await replayed.json()).error.message).toBe(REFILTERED_CURSOR_MESSAGE)
    expect(mockList).not.toHaveBeenCalled()
  })

  it('resumes a cursor replayed under the filters it was minted with', async () => {
    mockList.mockResolvedValue({
      knowledgeBases: [{ knowledgeBase: buildKnowledgeBase(), folderPath: '/' }],
      nextCursorKeys: ['Support docs', 'kb-1'],
      sortBy: 'name',
      sortOrder: 'desc',
    })

    const minted = await GET(
      new NextRequest(
        `http://localhost/api/v2/knowledge?workspaceId=${WORKSPACE_ID}&search=support`,
        { headers: { 'x-api-key': 'secret' } }
      )
    )
    const { nextCursor } = await minted.json()

    mockList.mockClear()
    const resumed = await GET(
      new NextRequest(
        `http://localhost/api/v2/knowledge?workspaceId=${WORKSPACE_ID}&search=support&cursor=${encodeURIComponent(nextCursor)}`,
        { headers: { 'x-api-key': 'secret' } }
      )
    )

    expect(resumed.status).toBe(200)
    expect(mockList).toHaveBeenCalledWith({
      principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
      input: expect.objectContaining({
        search: 'support',
        cursorKeys: ['Support docs', 'kb-1'],
      }),
      request: expect.anything(),
    })
  })

  it('returns 201 and keeps human analytics on the personal-key actor', async () => {
    const request = new NextRequest('http://localhost/api/v2/knowledge', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
      body: JSON.stringify({ workspaceId: WORKSPACE_ID, name: 'Support docs' }),
    })

    const response = await POST(request)

    expect(response.status).toBe(201)
    expect((await response.clone().json()).data.ownerEmail).toBe('owner@example.com')
    expect(mockCreate).toHaveBeenCalledWith({
      principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
      input: {
        workspaceId: WORKSPACE_ID,
        name: 'Support docs',
        description: undefined,
        chunkingConfig: { maxSize: 1024, minSize: 100, overlap: 200 },
        folderPath: undefined,
        source: 'api',
      },
      request,
    })
    expect(mockPlatformCreated).toHaveBeenCalledWith({
      knowledgeBaseId: 'kb-1',
      name: 'Support docs',
      workspaceId: WORKSPACE_ID,
    })
    expect(mockCapture).toHaveBeenCalledWith(
      'user-1',
      'knowledge_base_created',
      expect.objectContaining({ workspace_id: WORKSPACE_ID }),
      expect.any(Object)
    )
  })

  it('does not attribute workspace-key creation analytics to a billing owner', async () => {
    mockAuthenticate.mockResolvedValue({
      principal: { kind: 'workspace_api_key', workspaceId: WORKSPACE_ID, keyId: 'key-2' },
      rolloutUserId: 'billing-owner',
      rateLimitSubjectIds: ['api-key:key-2', `workspace:${WORKSPACE_ID}`],
      rateLimitSubscription: null,
      keyType: 'workspace',
    })
    const request = new NextRequest('http://localhost/api/v2/knowledge', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
      body: JSON.stringify({ workspaceId: WORKSPACE_ID, name: 'Support docs' }),
    })

    const response = await POST(request)

    expect(response.status).toBe(201)
    expect(mockPlatformCreated).toHaveBeenCalledOnce()
    expect(mockCapture).not.toHaveBeenCalled()
  })
})
