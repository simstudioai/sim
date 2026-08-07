/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockResolveWorkspaceAccess,
  mockCheckWorkspaceAccess,
  mockListVisibleWorkspaceCredentials,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceAccess: vi.fn(),
  mockCheckWorkspaceAccess: vi.fn(),
  mockListVisibleWorkspaceCredentials: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceAccess: mockResolveWorkspaceAccess,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: mockCheckWorkspaceAccess,
}))

vi.mock('@/lib/credentials/queries', () => ({
  listVisibleWorkspaceCredentials: mockListVisibleWorkspaceCredentials,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

import { GET } from '@/app/api/v2/credentials/route'

const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555'

const RATE_LIMIT_OK = {
  allowed: true,
  userId: 'user-1',
  keyType: 'workspace',
  limit: 100,
  remaining: 99,
  resetAt: new Date('2024-01-01T01:00:00Z'),
}

const RATE_LIMIT_DENIED = {
  allowed: false,
  limit: 100,
  remaining: 0,
  resetAt: new Date('2024-01-01T01:00:00Z'),
  retryAfterMs: 1000,
}

function buildVisible(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cred_abc123',
    workspaceId: WORKSPACE_ID,
    type: 'service_account' as const,
    displayName: 'Zoom account acct_123',
    description: null,
    providerId: 'zoom-service-account',
    accountId: null,
    envKey: null,
    envOwnerUserId: null,
    createdBy: 'user-1',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-02T00:00:00Z'),
    hasServiceAccountKey: true,
    role: 'admin' as const,
    ...overrides,
  }
}

const callList = (query: string) =>
  GET(new NextRequest(`http://localhost:3000/api/v2/credentials?${query}`))

describe('GET /api/v2/credentials', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockCheckWorkspaceAccess.mockResolvedValue({ hasAccess: true, canWrite: true, canAdmin: true })
    mockListVisibleWorkspaceCredentials.mockResolvedValue([buildVisible()])
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callList(`workspaceId=${WORKSPACE_ID}`)

    expect(res.status).toBe(404)
    expect(mockListVisibleWorkspaceCredentials).not.toHaveBeenCalled()
  })

  it('400s when workspaceId is missing', async () => {
    const res = await callList('')
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
    expect(mockListVisibleWorkspaceCredentials).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied failure in the v2 error envelope', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Access denied',
    })

    const res = await callList(`workspaceId=${WORKSPACE_ID}`)

    expect(res.status).toBe(403)
    expect(mockListVisibleWorkspaceCredentials).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED)

    const res = await callList(`workspaceId=${WORKSPACE_ID}`)

    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('returns connection metadata without environment-secret fields', async () => {
    const res = await callList(`workspaceId=${WORKSPACE_ID}`)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.nextCursor).toBeNull()
    expect(body.data).toEqual([
      {
        id: 'cred_abc123',
        type: 'service_account',
        displayName: 'Zoom account acct_123',
        description: null,
        providerId: 'zoom-service-account',
        accountId: null,
        hasServiceAccountKey: true,
        role: 'admin',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      },
    ])
    expect(JSON.stringify(body)).not.toContain('envKey')
    expect(mockListVisibleWorkspaceCredentials).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        userId: 'user-1',
        types: ['oauth', 'service_account'],
      })
    )
  })

  it('accepts only OAuth and service-account type filters', async () => {
    await callList(`workspaceId=${WORKSPACE_ID}&type=oauth&providerId=slack`)
    expect(mockListVisibleWorkspaceCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ types: ['oauth'], providerId: 'slack' })
    )

    const invalid = await callList(`workspaceId=${WORKSPACE_ID}&type=env_workspace`)
    expect(invalid.status).toBe(400)
  })

  it('rejects invalid list controls', async () => {
    const invalidSort = await callList(`workspaceId=${WORKSPACE_ID}&sortBy=name);--`)
    const invalidDirection = await callList(`workspaceId=${WORKSPACE_ID}&sortOrder=sideways`)
    const emptySearch = await callList(`workspaceId=${WORKSPACE_ID}&search=`)

    expect(invalidSort.status).toBe(400)
    expect(invalidDirection.status).toBe(400)
    expect(emptySearch.status).toBe(400)
  })
})
