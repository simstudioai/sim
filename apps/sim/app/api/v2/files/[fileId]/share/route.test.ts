/**
 * @vitest-environment node
 *
 * Public v2 file share. The two decisions that separate it from the internal
 * route are pinned here: the caller-supplied `token` is rejected, and a bare
 * re-enable keeps the token the orchestration already stored.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckRateLimit, mockResolveWorkspaceAccess, mockPerformGetShare, mockPerformUpsert } =
  vi.hoisted(() => ({
    mockCheckRateLimit: vi.fn(),
    mockResolveWorkspaceAccess: vi.fn(),
    mockPerformGetShare: vi.fn(),
    mockPerformUpsert: vi.fn(),
  }))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceAccess: mockResolveWorkspaceAccess,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/workspace-files/orchestration', () => ({
  performGetWorkspaceFileShare: mockPerformGetShare,
  performUpsertWorkspaceFileShare: mockPerformUpsert,
}))

import { GET, PUT } from '@/app/api/v2/files/[fileId]/share/route'

const WS = 'workspace-1'
const FILE_ID = 'wf_1'

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

const SHARE = {
  id: 'shr_1',
  token: 'existing-token-abcd',
  url: 'https://www.sim.ai/f/existing-token-abcd',
  isActive: true,
  resourceType: 'file' as const,
  resourceId: FILE_ID,
  authType: 'public' as const,
  hasPassword: false,
  allowedEmails: [] as string[],
}

const ctx = { params: Promise.resolve({ fileId: FILE_ID }) }

const callGet = (query: string) =>
  GET(new NextRequest(`http://localhost:3000/api/v2/files/${FILE_ID}/share?${query}`), ctx)

const callPut = (body: unknown) =>
  PUT(
    new NextRequest(`http://localhost:3000/api/v2/files/${FILE_ID}/share`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    ctx
  )

describe('GET /api/v2/files/[fileId]/share', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockPerformGetShare.mockResolvedValue({ success: true, share: SHARE })
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callGet(`workspaceId=${WS}`)

    expect(res.status).toBe(404)
    expect(mockPerformGetShare).not.toHaveBeenCalled()
  })

  it('400s when workspaceId is missing', async () => {
    const res = await callGet('')
    expect(res.status).toBe(400)
    expect(mockPerformGetShare).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied failure in the v2 error envelope', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Access denied',
    })
    const res = await callGet(`workspaceId=${WS}`)
    expect(res.status).toBe(403)
    expect(mockPerformGetShare).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED)
    const res = await callGet(`workspaceId=${WS}`)
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('reads at workspace read level and returns the share', async () => {
    const res = await callGet(`workspaceId=${WS}`)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toEqual({ share: SHARE })
    expect(mockResolveWorkspaceAccess).toHaveBeenCalledWith(expect.anything(), 'user-1', WS, 'read')
    expect(mockPerformGetShare).toHaveBeenCalledWith({ workspaceId: WS, fileId: FILE_ID })
  })

  it('returns a null share for a file that was never shared', async () => {
    mockPerformGetShare.mockResolvedValue({ success: true, share: null })
    const res = await callGet(`workspaceId=${WS}`)
    expect((await res.json()).data).toEqual({ share: null })
  })
})

describe('PUT /api/v2/files/[fileId]/share', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockPerformUpsert.mockResolvedValue({ success: true, share: SHARE })
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callPut({ workspaceId: WS, isActive: true })

    expect(res.status).toBe(404)
    expect(mockPerformUpsert).not.toHaveBeenCalled()
  })

  it('400s when isActive is missing', async () => {
    const res = await callPut({ workspaceId: WS })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
    expect(mockPerformUpsert).not.toHaveBeenCalled()
  })

  it('rejects a caller-supplied token instead of minting a predictable URL', async () => {
    const res = await callPut({
      workspaceId: WS,
      isActive: true,
      token: 'attacker-chosen-token',
    })

    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
    expect(mockPerformUpsert).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied failure in the v2 error envelope', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Access denied',
    })
    const res = await callPut({ workspaceId: WS, isActive: true })
    expect(res.status).toBe(403)
    expect(mockPerformUpsert).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED)
    const res = await callPut({ workspaceId: WS, isActive: true })
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('enables the share at workspace write level and never forwards a token', async () => {
    const res = await callPut({
      workspaceId: WS,
      isActive: true,
      authType: 'password',
      password: 'hunter2hunter2',
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toEqual({ share: SHARE })
    expect(mockResolveWorkspaceAccess).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      WS,
      'write'
    )
    expect(mockPerformUpsert).toHaveBeenCalledWith({
      workspaceId: WS,
      fileId: FILE_ID,
      userId: 'user-1',
      isActive: true,
      authType: 'password',
      password: 'hunter2hunter2',
      allowedEmails: undefined,
      request: expect.anything(),
    })
    expect(mockPerformUpsert.mock.calls[0][0]).not.toHaveProperty('token')
  })

  it('preserves the existing token on a bare re-enable', async () => {
    const res = await callPut({ workspaceId: WS, isActive: true })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.share.token).toBe('existing-token-abcd')
    expect(body.data.share.url).toBe('https://www.sim.ai/f/existing-token-abcd')
    // No authType either: the orchestration resolves the stored one, so the
    // access-control gate is evaluated against the real mode, not 'public'.
    expect(mockPerformUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: true, authType: undefined })
    )
  })

  it('maps a forbidden errorCode from the access-control policy to 403', async () => {
    mockPerformUpsert.mockResolvedValue({
      success: false,
      error: 'Public file sharing is not allowed based on your permission group settings',
      errorCode: 'forbidden',
    })

    const res = await callPut({ workspaceId: WS, isActive: true })
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error.code).toBe('FORBIDDEN')
    expect(body.error.message).toContain('not allowed')
  })

  it('maps a validation errorCode to 400', async () => {
    mockPerformUpsert.mockResolvedValue({
      success: false,
      error: 'Password is required for password-protected shares',
      errorCode: 'validation',
    })

    const res = await callPut({ workspaceId: WS, isActive: true, authType: 'password' })

    expect(res.status).toBe(400)
    expect((await res.json()).error.message).toBe(
      'Password is required for password-protected shares'
    )
  })
})
