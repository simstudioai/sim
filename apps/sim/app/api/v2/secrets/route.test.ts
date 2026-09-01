/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks, MockV2ApiKeyUnauthenticatedError } = vi.hoisted(() => {
  class MockV2ApiKeyUnauthenticatedError extends Error {}
  return {
    mocks: {
      authenticate: vi.fn(),
      preauthRate: vi.fn(),
      operationRate: vi.fn(),
      list: vi.fn(),
    },
    MockV2ApiKeyUnauthenticatedError,
  }
})

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => ({
  authenticateV2ApiKey: mocks.authenticate,
  V2ApiKeyUnauthenticatedError: MockV2ApiKeyUnauthenticatedError,
}))
vi.mock('@/lib/core/rate-limiter', () => ({
  RateLimiter: class {
    checkRateLimitDirect = mocks.preauthRate
    checkRateLimitDirectOrThrow = mocks.operationRate
  },
  getRateLimit: vi.fn().mockReturnValue({
    maxTokens: 100,
    refillRate: 100,
    refillIntervalMs: 60_000,
  }),
}))
vi.mock('@/lib/api/server/rate-limit-context', () => ({
  recordRateLimitSnapshot: vi.fn(),
  getRateLimitHeaders: vi.fn().mockReturnValue(null),
}))
vi.mock('@/lib/core/utils/request', () => ({
  generateRequestId: vi.fn().mockReturnValue('request-1'),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}))
vi.mock('@/lib/secrets/application/use-cases', () => ({
  listSecretsUseCase: { operation: { id: 'secrets.list' }, execute: mocks.list },
}))

import { V2_DEFAULT_PAGE_SIZE } from '@/lib/api/contracts/v2/shared'
import { REFILTERED_CURSOR_MESSAGE } from '@/lib/api/cursor-binding'
import { GET } from '@/app/api/v2/secrets/route'

const WORKSPACE_ID = 'workspace-1'
const PRINCIPAL = { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'key-personal' }
const AUTH = {
  principal: PRINCIPAL,
  rateLimitSubjectIds: ['user:user-1'] as const,
  rateLimitSubscription: null,
  keyType: 'personal' as const,
}
const RATE_LIMIT_OK = {
  allowed: true,
  limit: 100,
  remaining: 99,
  resetAt: new Date('2026-01-01T00:00:00Z'),
  retryAfterMs: 0,
}
const secret = {
  id: 'secret-1',
  workspaceId: WORKSPACE_ID,
  type: 'env_workspace' as const,
  displayName: 'STRIPE_API_KEY',
  description: null,
  providerId: null,
  accountId: null,
  envKey: 'STRIPE_API_KEY',
  envOwnerUserId: null,
  createdBy: 'user-1',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
  hasServiceAccountKey: false,
  role: 'admin' as const,
  unredacted: false,
}

describe('GET /api/v2/secrets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticate.mockResolvedValue(AUTH)
    mocks.preauthRate.mockResolvedValue(RATE_LIMIT_OK)
    mocks.operationRate.mockResolvedValue(RATE_LIMIT_OK)
    mocks.list.mockResolvedValue({
      secrets: [secret],
      values: {},
      userId: 'user-1',
      nextCursorKeys: null,
      sortBy: 'name',
      sortOrder: 'asc',
    })
  })

  it('lists secret metadata without exposing values', async () => {
    const response = await GET(
      new NextRequest(`http://localhost:3000/api/v2/secrets?workspaceId=${WORKSPACE_ID}`, {
        headers: { 'x-api-key': 'key' },
      })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      data: [
        {
          name: 'STRIPE_API_KEY',
          scope: 'workspace',
          description: null,
          unredacted: false,
          role: 'admin',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
      nextCursor: null,
    })
    expect(JSON.stringify(body)).not.toContain('"value"')
    expect(mocks.list).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        workspaceId: WORKSPACE_ID,
        scope: undefined,
        search: undefined,
        sortBy: 'name',
        sortOrder: 'asc',
        limit: V2_DEFAULT_PAGE_SIZE,
        cursor: undefined,
        cursorKeys: undefined,
      },
      request: expect.anything(),
    })
  })

  it('carries the stored value for exactly the rows marked visible', async () => {
    mocks.list.mockResolvedValue({
      secrets: [
        secret,
        {
          ...secret,
          id: 'secret-3',
          displayName: 'STAGING_BASE_URL',
          envKey: 'STAGING_BASE_URL',
          unredacted: true,
        },
      ],
      values: { STAGING_BASE_URL: 'https://staging.example.com' },
      userId: 'user-1',
      nextCursorKeys: null,
      sortBy: 'name',
      sortOrder: 'asc',
    })

    const response = await GET(
      new NextRequest(`http://localhost:3000/api/v2/secrets?workspaceId=${WORKSPACE_ID}`, {
        headers: { 'x-api-key': 'key' },
      })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data[0]).not.toHaveProperty('value')
    expect(body.data[1]).toMatchObject({
      name: 'STAGING_BASE_URL',
      unredacted: true,
      value: 'https://staging.example.com',
    })
  })

  it('never attaches an inherited prototype member as a missing value', async () => {
    mocks.list.mockResolvedValue({
      secrets: [
        {
          ...secret,
          id: 'secret-proto',
          displayName: 'constructor',
          envKey: 'constructor',
          unredacted: true,
        },
      ],
      /** The name is legal but its value is absent — a bare index would read Object's constructor. */
      values: {},
      userId: 'user-1',
      nextCursorKeys: null,
      sortBy: 'name',
      sortOrder: 'asc',
    })

    const response = await GET(
      new NextRequest(`http://localhost:3000/api/v2/secrets?workspaceId=${WORKSPACE_ID}`, {
        headers: { 'x-api-key': 'key' },
      })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data[0]).toMatchObject({ name: 'constructor', unredacted: true })
    expect(body.data[0]).not.toHaveProperty('value')
  })

  /**
   * Pins the binding end-to-end — the mint in `present` and the read in
   * `mapInput` — because the contract-level sweep only checks a hand-maintained
   * map of param names and stays green when a route drops the stamp entirely.
   */
  it('reports a workspace secret description and never a personal one', async () => {
    mocks.list.mockResolvedValue({
      secrets: [
        { ...secret, description: 'Prod billing key' },
        {
          ...secret,
          id: 'secret-2',
          type: 'env_personal' as const,
          displayName: 'MY_TEST_KEY',
          envKey: 'MY_TEST_KEY',
          envOwnerUserId: 'user-1',
          description: 'leaked from a workspace mirror',
        },
      ],
      values: {},
      userId: 'user-1',
      nextCursorKeys: null,
      sortBy: 'name',
      sortOrder: 'asc',
    })

    const response = await GET(
      new NextRequest(`http://localhost:3000/api/v2/secrets?workspaceId=${WORKSPACE_ID}`, {
        headers: { 'x-api-key': 'key' },
      })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data[0].description).toBe('Prod billing key')
    expect(body.data[1].description).toBeNull()
  })

  it('refuses a cursor minted under a different filter', async () => {
    mocks.list.mockResolvedValue({
      secrets: [secret],
      values: {},
      userId: 'user-1',
      nextCursorKeys: ['STRIPE_API_KEY', 'secret-1'],
      sortBy: 'name',
      sortOrder: 'asc',
    })

    const minted = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/secrets?workspaceId=${WORKSPACE_ID}&search=stripe`,
        { headers: { 'x-api-key': 'key' } }
      )
    )
    const { nextCursor } = await minted.json()
    expect(nextCursor).toEqual(expect.any(String))

    mocks.list.mockClear()
    const replayed = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/secrets?workspaceId=${WORKSPACE_ID}&search=twilio&cursor=${encodeURIComponent(nextCursor)}`,
        { headers: { 'x-api-key': 'key' } }
      )
    )

    expect(replayed.status).toBe(400)
    expect((await replayed.json()).error.message).toBe(REFILTERED_CURSOR_MESSAGE)
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('resumes a cursor replayed under the filters it was minted with', async () => {
    mocks.list.mockResolvedValue({
      secrets: [secret],
      values: {},
      userId: 'user-1',
      nextCursorKeys: ['STRIPE_API_KEY', 'secret-1'],
      sortBy: 'name',
      sortOrder: 'asc',
    })

    const minted = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/secrets?workspaceId=${WORKSPACE_ID}&search=stripe`,
        { headers: { 'x-api-key': 'key' } }
      )
    )
    const { nextCursor } = await minted.json()

    mocks.list.mockClear()
    const resumed = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/secrets?workspaceId=${WORKSPACE_ID}&search=stripe&cursor=${encodeURIComponent(nextCursor)}`,
        { headers: { 'x-api-key': 'key' } }
      )
    )

    expect(resumed.status).toBe(200)
    expect(mocks.list).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: expect.objectContaining({
        search: 'stripe',
        cursorKeys: ['STRIPE_API_KEY', 'secret-1'],
      }),
      request: expect.anything(),
    })
  })

  it('authenticates before validating list input', async () => {
    mocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await GET(new NextRequest('http://localhost:3000/api/v2/secrets'))

    expect(response.status).toBe(401)
    expect(mocks.list).not.toHaveBeenCalled()
  })
})
