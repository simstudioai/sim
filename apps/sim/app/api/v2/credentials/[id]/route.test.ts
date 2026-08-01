/**
 * @vitest-environment node
 *
 * Public v2 credential detail: workspace scoping of the id, the 404 mask for a
 * credential the caller has no membership on, and secret-free reads.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockResolveWorkspaceAccess,
  mockGetWorkspaceCredential,
  mockGetCredentialActorContext,
  mockPerformUpdateCredential,
  mockPerformDeleteCredential,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceAccess: vi.fn(),
  mockGetWorkspaceCredential: vi.fn(),
  mockGetCredentialActorContext: vi.fn(),
  mockPerformUpdateCredential: vi.fn(),
  mockPerformDeleteCredential: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceAccess: mockResolveWorkspaceAccess,
}))

vi.mock('@/lib/credentials/queries', () => ({
  getWorkspaceCredential: mockGetWorkspaceCredential,
}))

vi.mock('@/lib/credentials/access', () => ({
  getCredentialActorContext: mockGetCredentialActorContext,
}))

vi.mock('@/lib/credentials/orchestration', () => ({
  performUpdateCredential: mockPerformUpdateCredential,
  performDeleteCredential: mockPerformDeleteCredential,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

import { DELETE, GET, PATCH } from '@/app/api/v2/credentials/[id]/route'

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

const ACCESS_DENIED = { status: 403, code: 'FORBIDDEN', message: 'Access denied' }

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

const routeContext = () => ({ params: Promise.resolve({ id: 'cred_abc123' }) })
const url = (query = `workspaceId=${WORKSPACE_ID}`) =>
  `http://localhost:3000/api/v2/credentials/cred_abc123?${query}`

const callGet = (query?: string) => GET(new NextRequest(url(query)), routeContext())
const callDelete = (query?: string) =>
  DELETE(new NextRequest(url(query), { method: 'DELETE' }), routeContext())

function callPatch(body: unknown) {
  return PATCH(
    new NextRequest('http://localhost:3000/api/v2/credentials/cred_abc123', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    routeContext()
  )
}

describe('GET /api/v2/credentials/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockGetWorkspaceCredential.mockResolvedValue(buildRow())
    mockGetCredentialActorContext.mockResolvedValue({ member: { role: 'admin' }, isAdmin: true })
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callGet()

    expect(res.status).toBe(404)
    expect(mockGetWorkspaceCredential).not.toHaveBeenCalled()
  })

  it('400s when workspaceId is missing', async () => {
    const res = await callGet('')
    expect(res.status).toBe(400)
    expect(mockGetWorkspaceCredential).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied failure in the v2 error envelope', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue(ACCESS_DENIED)
    const res = await callGet()
    expect(res.status).toBe(403)
    expect(mockGetWorkspaceCredential).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED)
    const res = await callGet()
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('404s when the credential belongs to another workspace', async () => {
    mockGetWorkspaceCredential.mockResolvedValue(null)
    const res = await callGet()
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('NOT_FOUND')
  })

  it('masks a credential the caller has no membership on as 404', async () => {
    mockGetCredentialActorContext.mockResolvedValue({ member: null, isAdmin: false })
    const res = await callGet()
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('NOT_FOUND')
  })

  it('returns the public shape with no secret material', async () => {
    const res = await callGet()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.credential).toEqual({
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
    })
    expect(JSON.stringify(body)).not.toContain('encrypted-blob')
  })
})

describe('PATCH /api/v2/credentials/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockGetWorkspaceCredential.mockResolvedValue(buildRow())
    mockGetCredentialActorContext.mockResolvedValue({ member: { role: 'admin' }, isAdmin: true })
    mockPerformUpdateCredential.mockResolvedValue({ success: true })
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callPatch({ workspaceId: WORKSPACE_ID, displayName: 'Renamed' })

    expect(res.status).toBe(404)
    expect(mockPerformUpdateCredential).not.toHaveBeenCalled()
  })

  it('400s when no field to change is supplied', async () => {
    const res = await callPatch({ workspaceId: WORKSPACE_ID })
    expect(res.status).toBe(400)
    expect(mockPerformUpdateCredential).not.toHaveBeenCalled()
  })

  it('400s when the body carries an unknown field', async () => {
    const res = await callPatch({ workspaceId: WORKSPACE_ID, bogus: 'x' })
    expect(res.status).toBe(400)
    expect(mockPerformUpdateCredential).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied failure in the v2 error envelope', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue(ACCESS_DENIED)
    const res = await callPatch({ workspaceId: WORKSPACE_ID, displayName: 'Renamed' })
    expect(res.status).toBe(403)
    expect(mockPerformUpdateCredential).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED)
    const res = await callPatch({ workspaceId: WORKSPACE_ID, displayName: 'Renamed' })
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('404s when the credential belongs to another workspace', async () => {
    mockGetWorkspaceCredential.mockResolvedValue(null)
    const res = await callPatch({ workspaceId: WORKSPACE_ID, displayName: 'Renamed' })
    expect(res.status).toBe(404)
    expect(mockPerformUpdateCredential).not.toHaveBeenCalled()
  })

  it('403s when the caller is not a credential admin', async () => {
    mockPerformUpdateCredential.mockResolvedValue({
      success: false,
      error: 'Credential admin permission required',
      errorCode: 'forbidden',
    })
    const res = await callPatch({ workspaceId: WORKSPACE_ID, displayName: 'Renamed' })
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('FORBIDDEN')
  })

  it('gates on workspace read, leaving admin rights to the per-credential check', async () => {
    await callPatch({ workspaceId: WORKSPACE_ID, displayName: 'Renamed' })
    expect(mockResolveWorkspaceAccess).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      WORKSPACE_ID,
      'read'
    )
  })

  it('masks a credential the caller cannot see as 404, not 403', async () => {
    mockGetCredentialActorContext.mockResolvedValue({ member: null, isAdmin: false })
    const res = await callPatch({ workspaceId: WORKSPACE_ID, displayName: 'Renamed' })
    expect(res.status).toBe(404)
    expect(mockPerformUpdateCredential).not.toHaveBeenCalled()
  })

  it('503s when the provider is unreachable during a secret rotation', async () => {
    mockPerformUpdateCredential.mockResolvedValue({
      success: false,
      error: 'provider_unavailable',
      errorCode: 'validation',
      providerErrorCode: 'provider_unavailable',
    })
    const res = await callPatch({ workspaceId: WORKSPACE_ID, apiToken: 'tok' })
    expect(res.status).toBe(503)
    expect((await res.json()).error.code).toBe('SERVICE_UNAVAILABLE')
  })

  it('rotates a secret without echoing it back', async () => {
    const res = await callPatch({ workspaceId: WORKSPACE_ID, apiToken: 'brand-new-token' })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(JSON.stringify(body)).not.toContain('brand-new-token')
    expect(mockPerformUpdateCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialId: 'cred_abc123',
        userId: 'user-1',
        apiToken: 'brand-new-token',
      })
    )
  })
})

describe('DELETE /api/v2/credentials/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockGetWorkspaceCredential.mockResolvedValue(buildRow())
    mockGetCredentialActorContext.mockResolvedValue({ member: { role: 'admin' }, isAdmin: true })
    mockPerformDeleteCredential.mockResolvedValue({ success: true })
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callDelete()

    expect(res.status).toBe(404)
    expect(mockPerformDeleteCredential).not.toHaveBeenCalled()
  })

  it('400s when workspaceId is missing', async () => {
    const res = await callDelete('')
    expect(res.status).toBe(400)
    expect(mockPerformDeleteCredential).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied failure in the v2 error envelope', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue(ACCESS_DENIED)
    const res = await callDelete()
    expect(res.status).toBe(403)
    expect(mockPerformDeleteCredential).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED)
    const res = await callDelete()
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('404s when the credential belongs to another workspace', async () => {
    mockGetWorkspaceCredential.mockResolvedValue(null)
    const res = await callDelete()
    expect(res.status).toBe(404)
    expect(mockPerformDeleteCredential).not.toHaveBeenCalled()
  })

  it('gates on workspace read, leaving admin rights to the per-credential check', async () => {
    await callDelete()
    expect(mockResolveWorkspaceAccess).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      WORKSPACE_ID,
      'read'
    )
  })

  it('masks a credential the caller cannot see as 404, not 403', async () => {
    mockGetCredentialActorContext.mockResolvedValue({ member: null, isAdmin: false })
    const res = await callDelete()
    expect(res.status).toBe(404)
    expect(mockPerformDeleteCredential).not.toHaveBeenCalled()
  })

  it('deletes the credential and acknowledges the id', async () => {
    const res = await callDelete()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { id: 'cred_abc123', deleted: true } })
    expect(mockPerformDeleteCredential).toHaveBeenCalledWith(
      expect.objectContaining({ credentialId: 'cred_abc123', userId: 'user-1' })
    )
  })
})
