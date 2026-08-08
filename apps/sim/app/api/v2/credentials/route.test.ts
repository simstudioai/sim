/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  checkPreauth: vi.fn(),
  checkOperationRate: vi.fn(),
  gate: vi.fn(),
  execute: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => ({
  authenticateV2ApiKey: mocks.authenticate,
  V2ApiKeyUnauthenticatedError: class V2ApiKeyUnauthenticatedError extends Error {},
}))

vi.mock('@/lib/core/rate-limiter', () => ({
  getRateLimit: () => ({ maxTokens: 100, refillRate: 50, refillIntervalMs: 60_000 }),
  RateLimiter: class RateLimiter {
    checkRateLimitDirect = mocks.checkPreauth
    checkRateLimitDirectOrThrow = mocks.checkOperationRate
  },
}))

vi.mock('@/app/api/v2/lib/gate', () => ({ v2ApiGateError: mocks.gate }))

vi.mock('@/lib/credentials/application/list-workspace-credentials', () => ({
  listWorkspaceCredentials: {
    operation: { id: 'credentials.connections.list' },
    execute: mocks.execute,
  },
}))

import { GET } from '@/app/api/v2/credentials/route'

const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555'
const auth = {
  principal: {
    kind: 'workspace_api_key' as const,
    workspaceId: WORKSPACE_ID,
    keyId: 'key-1',
  },
  rolloutUserId: 'billing-owner-1',
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
const credential = {
  id: 'credential-1',
  workspaceId: WORKSPACE_ID,
  type: 'service_account' as const,
  displayName: 'Zoom account',
  description: null,
  providerId: 'zoom-service-account',
  accountId: null,
  envKey: 'MUST_NOT_LEAK',
  envOwnerUserId: null,
  createdBy: 'user-1',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
  hasServiceAccountKey: true,
  role: 'member' as const,
}

describe('GET /api/v2/credentials', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticate.mockResolvedValue(auth)
    mocks.gate.mockResolvedValue(null)
    mocks.checkPreauth.mockResolvedValue({
      allowed: true,
      remaining: 599,
      resetAt: new Date('2026-01-01T01:00:00Z'),
    })
    mocks.checkOperationRate.mockResolvedValue({
      allowed: true,
      remaining: 99,
      resetAt: new Date('2026-01-01T01:00:00Z'),
    })
    mocks.execute.mockResolvedValue({ credentials: [credential] })
  })

  it('authenticates and charges before validating workspace input', async () => {
    const response = await GET(new NextRequest('http://localhost:3000/api/v2/credentials'))

    expect(response.status).toBe(400)
    expect(mocks.authenticate).toHaveBeenCalled()
    expect(mocks.checkOperationRate).toHaveBeenCalledTimes(2)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('calls the application operation with the workspace principal', async () => {
    const request = new NextRequest(
      `http://localhost:3000/api/v2/credentials?workspaceId=${WORKSPACE_ID}&type=service_account`
    )
    const response = await GET(request)

    expect(response.status).toBe(200)
    expect(mocks.execute).toHaveBeenCalledWith({
      principal: auth.principal,
      input: {
        workspaceId: WORKSPACE_ID,
        type: 'service_account',
        providerId: undefined,
        search: undefined,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      },
      request,
    })
  })

  it('projects credential metadata field by field without secret material', async () => {
    const response = await GET(
      new NextRequest(`http://localhost:3000/api/v2/credentials?workspaceId=${WORKSPACE_ID}`)
    )
    const body = await response.json()

    expect(body).toEqual({
      data: [
        {
          id: 'credential-1',
          type: 'service_account',
          displayName: 'Zoom account',
          description: null,
          providerId: 'zoom-service-account',
          accountId: null,
          hasServiceAccountKey: true,
          role: 'member',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
      nextCursor: null,
    })
    expect(JSON.stringify(body)).not.toContain('envKey')
    expect(JSON.stringify(body)).not.toContain('createdBy')
  })

  it('hides repository errors that may contain secret details', async () => {
    mocks.execute.mockRejectedValueOnce(new Error('encryptedServiceAccountKey failed'))

    const response = await GET(
      new NextRequest(`http://localhost:3000/api/v2/credentials?workspaceId=${WORKSPACE_ID}`)
    )

    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
  })
})
