/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockResolveActiveShareByToken,
  mockEnforceRateLimit,
  mockValidateDeploymentAuth,
  mockSetDeploymentAuthCookie,
} = vi.hoisted(() => ({
  mockResolveActiveShareByToken: vi.fn(),
  mockEnforceRateLimit: vi.fn(),
  mockValidateDeploymentAuth: vi.fn(),
  mockSetDeploymentAuthCookie: vi.fn(),
}))

vi.mock('@/lib/public-shares/share-manager', () => ({
  resolveActiveShareByToken: mockResolveActiveShareByToken,
}))

vi.mock('@/lib/public-shares/rate-limit', () => ({
  enforcePublicFileRateLimit: mockEnforceRateLimit,
}))

vi.mock('@/lib/core/security/deployment-auth', () => ({
  validateDeploymentAuth: mockValidateDeploymentAuth,
}))

vi.mock('@/lib/core/security/deployment', () => ({
  setDeploymentAuthCookie: mockSetDeploymentAuthCookie,
}))

import { NextResponse } from 'next/server'
import { GET, POST } from '@/app/api/files/public/[token]/route'

const params = (token = 'tok_1') => ({ params: Promise.resolve({ token }) })
const request = (token = 'tok_1') => new NextRequest(`http://localhost/api/files/public/${token}`)
const postRequest = (password: string, token = 'tok_1') =>
  new NextRequest(`http://localhost/api/files/public/${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  })

const publicShare = {
  share: { id: 'sh_1', token: 'tok_1', authType: 'public', password: null },
  file: {
    id: 'wf_1',
    key: 'workspace/ws/secret-key.pdf',
    workspaceId: 'ws-secret',
    originalName: 'report.pdf',
    contentType: 'application/pdf',
    size: 2048,
  },
  workspaceName: 'Acme Workspace',
  ownerName: 'Jane Doe',
}

const passwordShare = {
  ...publicShare,
  share: { id: 'sh_1', token: 'tok_1', authType: 'password', password: 'enc:secret' },
}

describe('GET /api/files/public/[token]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnforceRateLimit.mockResolvedValue(null) // allow by default
    mockValidateDeploymentAuth.mockResolvedValue({ authorized: true }) // public by default
  })

  it('returns 429 when the per-IP rate limit is exceeded', async () => {
    mockEnforceRateLimit.mockResolvedValueOnce(
      NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
    )
    const res = await GET(request(), params())
    expect(res.status).toBe(429)
    expect(mockResolveActiveShareByToken).not.toHaveBeenCalled()
  })

  it('returns 404 for an unknown or inactive token', async () => {
    mockResolveActiveShareByToken.mockResolvedValueOnce(null)
    const res = await GET(request(), params())
    expect(res.status).toBe(404)
  })

  it('returns public-safe metadata without leaking the key or workspace id', async () => {
    mockResolveActiveShareByToken.mockResolvedValueOnce(publicShare)
    const res = await GET(request(), params())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      token: 'tok_1',
      name: 'report.pdf',
      type: 'application/pdf',
      size: 2048,
      workspaceName: 'Acme Workspace',
      ownerName: 'Jane Doe',
    })
    expect(JSON.stringify(body)).not.toContain('secret-key')
    expect(JSON.stringify(body)).not.toContain('ws-secret')
  })

  it('returns 401 auth_required_password for a password share without a valid cookie', async () => {
    mockResolveActiveShareByToken.mockResolvedValueOnce(passwordShare)
    mockValidateDeploymentAuth.mockResolvedValueOnce({
      authorized: false,
      error: 'auth_required_password',
    })
    const res = await GET(request(), params())
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('auth_required_password')
    expect(mockValidateDeploymentAuth).toHaveBeenCalledWith(
      expect.any(String),
      passwordShare.share,
      expect.anything(),
      undefined,
      'file'
    )
  })

  it('serves metadata for a password share once authorized by cookie', async () => {
    mockResolveActiveShareByToken.mockResolvedValueOnce(passwordShare)
    mockValidateDeploymentAuth.mockResolvedValueOnce({ authorized: true })
    const res = await GET(request(), params())
    expect(res.status).toBe(200)
    expect((await res.json()).name).toBe('report.pdf')
  })
})

describe('POST /api/files/public/[token]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveActiveShareByToken.mockResolvedValue(passwordShare)
  })

  it('sets the file_auth cookie and returns the authType on a correct password', async () => {
    mockValidateDeploymentAuth.mockResolvedValueOnce({ authorized: true })
    const res = await POST(postRequest('hunter2'), params())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ authType: 'password' })
    expect(mockSetDeploymentAuthCookie).toHaveBeenCalledWith(
      expect.anything(),
      'file',
      'sh_1',
      'password',
      'enc:secret'
    )
  })

  it('refuses to mint a cookie for a non-password (e.g. public) share', async () => {
    mockResolveActiveShareByToken.mockResolvedValueOnce({
      ...passwordShare,
      share: { id: 'sh_1', token: 'tok_1', authType: 'public', password: null },
    })
    const res = await POST(postRequest('whatever'), params())
    expect(res.status).toBe(400)
    expect(mockValidateDeploymentAuth).not.toHaveBeenCalled()
    expect(mockSetDeploymentAuthCookie).not.toHaveBeenCalled()
  })

  it('returns 401 Invalid password on mismatch without setting a cookie', async () => {
    mockValidateDeploymentAuth.mockResolvedValueOnce({
      authorized: false,
      error: 'Invalid password',
    })
    const res = await POST(postRequest('wrong'), params())
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('Invalid password')
    expect(mockSetDeploymentAuthCookie).not.toHaveBeenCalled()
  })

  it('returns 429 with Retry-After when password attempts are rate-limited', async () => {
    mockValidateDeploymentAuth.mockResolvedValueOnce({
      authorized: false,
      error: 'Too many attempts. Please try again later.',
      status: 429,
      retryAfterMs: 60_000,
    })
    const res = await POST(postRequest('wrong'), params())
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('60')
    expect(mockSetDeploymentAuthCookie).not.toHaveBeenCalled()
  })

  it('returns 404 for an unknown token', async () => {
    mockResolveActiveShareByToken.mockResolvedValueOnce(null)
    const res = await POST(postRequest('hunter2'), params())
    expect(res.status).toBe(404)
  })
})
