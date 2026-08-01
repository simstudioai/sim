/**
 * @vitest-environment node
 *
 * Public v2 credentials list/create: gate ordering, the write-only treatment of
 * secret material, and the exclusion of `oauth` from the creatable types.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockResolveWorkspaceAccess,
  mockCheckWorkspaceAccess,
  mockListVisibleWorkspaceCredentials,
  mockPerformCreateCredential,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceAccess: vi.fn(),
  mockCheckWorkspaceAccess: vi.fn(),
  mockListVisibleWorkspaceCredentials: vi.fn(),
  mockPerformCreateCredential: vi.fn(),
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

vi.mock('@/lib/credentials/orchestration', () => ({
  performCreateCredential: mockPerformCreateCredential,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

import { GET, POST } from '@/app/api/v2/credentials/route'

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

function buildRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cred_abc123',
    workspaceId: WORKSPACE_ID,
    type: 'service_account',
    displayName: 'Zoom account acct_123',
    description: null,
    providerId: 'zoom-service-account',
    accountId: null,
    envKey: null,
    envOwnerUserId: null,
    encryptedServiceAccountKey: 'encrypted-blob',
    createdBy: 'user-1',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-02T00:00:00Z'),
    ...overrides,
  }
}

const callList = (query: string) =>
  GET(new NextRequest(`http://localhost:3000/api/v2/credentials?${query}`))

function callCreate(body: unknown) {
  return POST(
    new NextRequest('http://localhost:3000/api/v2/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  )
}

const VALID_BODY = {
  workspaceId: WORKSPACE_ID,
  type: 'env_workspace',
  envKey: 'STRIPE_API_KEY',
}

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

  it('returns the public credential shape with no secret material', async () => {
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
        envKey: null,
        hasServiceAccountKey: true,
        role: 'admin',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      },
    ])
    expect(mockListVisibleWorkspaceCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WORKSPACE_ID, userId: 'user-1' })
    )
  })

  it('passes the type and providerId filters through', async () => {
    await callList(`workspaceId=${WORKSPACE_ID}&type=oauth&providerId=slack`)
    expect(mockListVisibleWorkspaceCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'oauth', providerId: 'slack' })
    )
  })
})

describe('POST /api/v2/credentials', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockPerformCreateCredential.mockResolvedValue({
      success: true,
      credential: buildRow(),
      created: true,
    })
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callCreate(VALID_BODY)

    expect(res.status).toBe(404)
    expect(mockPerformCreateCredential).not.toHaveBeenCalled()
  })

  it('400s when envKey is missing for an env credential', async () => {
    const res = await callCreate({ workspaceId: WORKSPACE_ID, type: 'env_workspace' })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
    expect(mockPerformCreateCredential).not.toHaveBeenCalled()
  })

  it('400s when envKey is not a valid environment variable name', async () => {
    const res = await callCreate({ ...VALID_BODY, envKey: 'not-a-valid-name' })
    expect(res.status).toBe(400)
    expect(mockPerformCreateCredential).not.toHaveBeenCalled()
  })

  it('400s on an oauth create, which requires the interactive connect flow', async () => {
    const res = await callCreate({
      workspaceId: WORKSPACE_ID,
      type: 'oauth',
      providerId: 'slack',
      accountId: 'acct_1',
      displayName: 'Slack',
    })
    expect(res.status).toBe(400)
    expect(mockPerformCreateCredential).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied failure in the v2 error envelope', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Access denied',
    })
    const res = await callCreate(VALID_BODY)
    expect(res.status).toBe(403)
    expect(mockPerformCreateCredential).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED)
    const res = await callCreate(VALID_BODY)
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('maps a provider outage to 503 rather than a bad request', async () => {
    mockPerformCreateCredential.mockResolvedValue({
      success: false,
      error: 'provider_unavailable',
      errorCode: 'validation',
      providerErrorCode: 'provider_unavailable',
      providerUnavailable: true,
    })
    const res = await callCreate(VALID_BODY)
    expect(res.status).toBe(503)
    expect((await res.json()).error.code).toBe('SERVICE_UNAVAILABLE')
  })

  it('creates the credential and never echoes the submitted secret', async () => {
    const res = await callCreate({
      workspaceId: WORKSPACE_ID,
      type: 'service_account',
      providerId: 'zoom-service-account',
      clientId: 'zoom-client-id',
      clientSecret: 'super-secret-value',
      orgId: 'acct_123',
    })
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data.credential).toMatchObject({
      id: 'cred_abc123',
      hasServiceAccountKey: true,
      role: 'admin',
    })
    expect(JSON.stringify(body)).not.toContain('super-secret-value')
    expect(JSON.stringify(body)).not.toContain('encrypted-blob')
    expect(mockPerformCreateCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        userId: 'user-1',
        type: 'service_account',
        clientSecret: 'super-secret-value',
      })
    )
  })
})
