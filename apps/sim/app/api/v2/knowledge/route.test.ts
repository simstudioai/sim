import {
  createPersonalApiKeyPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import {
  knowledgeBaseUseCasesMock,
  knowledgeBaseUseCasesMockFns,
} from '@sim/testing/mocks/knowledge-base-use-cases.mock'
import { posthogServerMock, posthogServerMockFns } from '@sim/testing/mocks/posthog-server.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { getMockPlatformEvent, telemetryMock } from '@sim/testing/mocks/telemetry.mock'
import { usersQueriesMock, usersQueriesMockFns } from '@sim/testing/mocks/users-queries.mock'
import {
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing/mocks/v2-route.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)

vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

vi.mock('@/lib/knowledge/application/knowledge-bases', () => knowledgeBaseUseCasesMock)

vi.mock('@/lib/core/telemetry', () => telemetryMock)

vi.mock('@/lib/posthog/server', () => posthogServerMock)
vi.mock('@/lib/users/queries', () => usersQueriesMock)

import { v2ListKnowledgeBasesContract } from '@/lib/api/contracts/v2/knowledge'
import { cursorRoute, cursorScopeKey, REFILTERED_CURSOR_MESSAGE } from '@/lib/api/cursor-binding'
import { GET, POST } from '@/app/api/v2/knowledge/route'
import { writeSortedCursor } from '@/app/api/v2/lib/response'

const { mockGetUserEmailsByIds } = usersQueriesMockFns

const mockPlatformCreated = getMockPlatformEvent('knowledgeBaseCreated')

const mockList = knowledgeBaseUseCasesMockFns.mockListKnowledgeBasesExecute
const mockCreate = knowledgeBaseUseCasesMockFns.mockCreateKnowledgeBaseExecute
const mockCapture = posthogServerMockFns.mockCaptureServerEvent
const mockAuthenticate = v2RouteMocks.authenticate
const mockCheckPreAuth = v2RouteMocks.preauthRate
const mockCheckRateLimit = v2RouteMocks.operationRate

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
    mockCheckPreAuth.mockResolvedValue(RATE_LIMIT_OK)
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockAuthenticate.mockResolvedValue({
      principal: createPersonalApiKeyPrincipal(),
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

  /**
   * Pins the binding end-to-end — the mint in `present` and the read in
   * `mapInput` — because the contract-level sweep only checks a hand-maintained
   * map of param names and stays green when a route drops the stamp entirely.
   */
  it('refuses a cursor minted under one scope and replayed under the other', async () => {
    mockList.mockResolvedValue({
      knowledgeBases: [{ knowledgeBase: buildKnowledgeBase(), folderPath: '/' }],
      nextCursorKeys: ['Support docs', 'kb-1'],
      sortBy: 'name',
      sortOrder: 'desc',
    })

    const minted = await GET(
      createMockRequest({
        url: `http://localhost/api/v2/knowledge?workspaceId=${WORKSPACE_ID}`,
        headers: { 'x-api-key': 'secret' },
      })
    )
    const { nextCursor } = await minted.json()

    mockList.mockClear()
    const replayed = await GET(
      createMockRequest({
        url: `http://localhost/api/v2/knowledge?workspaceId=${WORKSPACE_ID}&scope=archived&cursor=${encodeURIComponent(nextCursor)}`,
        headers: { 'x-api-key': 'secret' },
      })
    )

    expect(replayed.status).toBe(400)
    expect((await replayed.json()).error.message).toBe(REFILTERED_CURSOR_MESSAGE)
    expect(mockList).not.toHaveBeenCalled()
  })

  /**
   * `scope` carries `.default('active')`, so it is present on every parsed
   * query — and it is new on this list. Stamping it unconditionally would put a
   * constant in every fingerprint and refuse every cursor the deployed build
   * handed out, reporting {@link REFILTERED_CURSOR_MESSAGE} to a caller that
   * changed nothing. The default must contribute nothing to the scope.
   */
  it('resumes a cursor minted before scope entered the binding', async () => {
    mockList.mockResolvedValue({
      knowledgeBases: [{ knowledgeBase: buildKnowledgeBase(), folderPath: '/' }],
      nextCursorKeys: undefined,
      sortBy: 'name',
      sortOrder: 'desc',
    })
    const legacyCursor = writeSortedCursor(
      ['Support docs', 'kb-1'],
      'name',
      'desc',
      cursorScopeKey(cursorRoute(v2ListKnowledgeBasesContract), { workspaceId: WORKSPACE_ID })
    ) as string

    const response = await GET(
      createMockRequest({
        url: `http://localhost/api/v2/knowledge?workspaceId=${WORKSPACE_ID}&sortBy=name&sortOrder=desc&cursor=${encodeURIComponent(legacyCursor)}`,
        headers: { 'x-api-key': 'secret' },
      })
    )

    expect(response.status).toBe(200)
    expect(mockList).toHaveBeenCalled()
  })

  it('refuses a cursor minted under a different filter', async () => {
    mockList.mockResolvedValue({
      knowledgeBases: [{ knowledgeBase: buildKnowledgeBase(), folderPath: '/' }],
      nextCursorKeys: ['Support docs', 'kb-1'],
      sortBy: 'name',
      sortOrder: 'desc',
    })

    const minted = await GET(
      createMockRequest({
        url: `http://localhost/api/v2/knowledge?workspaceId=${WORKSPACE_ID}&search=support`,
        headers: { 'x-api-key': 'secret' },
      })
    )
    const { nextCursor } = await minted.json()
    expect(nextCursor).toEqual(expect.any(String))

    mockList.mockClear()
    const replayed = await GET(
      createMockRequest({
        url: `http://localhost/api/v2/knowledge?workspaceId=${WORKSPACE_ID}&search=billing&cursor=${encodeURIComponent(nextCursor)}`,
        headers: { 'x-api-key': 'secret' },
      })
    )

    expect(replayed.status).toBe(400)
    expect((await replayed.json()).error.message).toBe(REFILTERED_CURSOR_MESSAGE)
    expect(mockList).not.toHaveBeenCalled()
  })

  it('does not attribute workspace-key creation analytics to a billing owner', async () => {
    mockAuthenticate.mockResolvedValue({
      principal: createWorkspaceApiKeyPrincipal({ workspaceId: WORKSPACE_ID, keyId: 'key-2' }),
      rateLimitSubjectIds: ['api-key:key-2', `workspace:${WORKSPACE_ID}`],
      rateLimitSubscription: null,
      keyType: 'workspace',
    })
    const request = createMockRequest({
      method: 'POST',
      url: 'http://localhost/api/v2/knowledge',
      headers: { 'x-api-key': 'secret' },
      body: { workspaceId: WORKSPACE_ID, name: 'Support docs' },
    })

    const response = await POST(request)

    expect(response.status).toBe(201)
    expect(mockPlatformCreated).toHaveBeenCalledOnce()
    expect(mockCapture).not.toHaveBeenCalled()
  })
})
