/**
 * @vitest-environment node
 *
 * The password exchange is the only route that mints an
 * `interface_auth_{shareId}` cookie. §2.9 requires it to refuse every auth mode
 * but `password`, otherwise a `public` share could be used to mint a cookie
 * with an empty password slot that would later satisfy an `email`/`sso` gate.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockResolveActiveInterfaceShareByToken,
  mockResolveActiveShareByToken,
  mockValidateDeploymentAuth,
  mockSetDeploymentAuthCookie,
} = vi.hoisted(() => ({
  mockResolveActiveInterfaceShareByToken: vi.fn(),
  mockResolveActiveShareByToken: vi.fn(),
  mockValidateDeploymentAuth: vi.fn(),
  mockSetDeploymentAuthCookie: vi.fn(),
}))

vi.mock('@/lib/public-shares/share-manager', () => ({
  resolveActiveInterfaceShareByToken: mockResolveActiveInterfaceShareByToken,
  resolveActiveShareByToken: mockResolveActiveShareByToken,
}))

vi.mock('@/lib/core/security/deployment-auth', () => ({
  validateDeploymentAuth: mockValidateDeploymentAuth,
}))

vi.mock('@/lib/core/security/deployment', () => ({
  setDeploymentAuthCookie: mockSetDeploymentAuthCookie,
}))

import { POST } from '@/app/api/interfaces/public/[token]/route'

const TOKEN = 'tok_1'

const params = (token = TOKEN) => ({ params: Promise.resolve({ token }) })

const postRequest = (body: unknown, token = TOKEN) =>
  new NextRequest(`http://localhost/api/interfaces/public/${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

function buildResolved(share: Record<string, unknown> = {}) {
  return {
    share: {
      id: 'sh_1',
      token: TOKEN,
      authType: 'password',
      password: 'enc:secret',
      allowedEmails: [],
      ...share,
    },
    definition: {
      id: 'int-1',
      workspaceId: 'ws-secret',
      name: 'Confidential desk',
      description: null,
      layout: { version: 1, grid: { rows: 2, cols: 2 }, modules: [] },
      createdBy: 'user-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      archivedAt: null,
    },
    workspaceId: 'ws-secret',
    workspaceName: 'Acme',
    ownerName: 'Ada',
  }
}

describe('POST /api/interfaces/public/[token]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveActiveInterfaceShareByToken.mockResolvedValue(buildResolved())
    mockValidateDeploymentAuth.mockResolvedValue({ authorized: true })
  })

  it('resolves through the interface resolver, never the file resolver', async () => {
    await POST(postRequest({ password: 'hunter22' }), params())
    expect(mockResolveActiveInterfaceShareByToken).toHaveBeenCalledWith(TOKEN)
    expect(mockResolveActiveShareByToken).not.toHaveBeenCalled()
  })

  it('mints an interface_auth cookie on a correct password', async () => {
    const res = await POST(postRequest({ password: 'hunter22' }), params())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ authType: 'password' })
    expect(mockSetDeploymentAuthCookie).toHaveBeenCalledWith(
      expect.anything(),
      'interface',
      'sh_1',
      'password',
      'enc:secret'
    )
  })

  it.each(['public', 'email', 'sso'])(
    'refuses to mint a cookie for a %s share',
    async (authType) => {
      mockResolveActiveInterfaceShareByToken.mockResolvedValueOnce(
        buildResolved({ authType, password: null })
      )
      const res = await POST(postRequest({ password: 'whatever' }), params())
      expect(res.status).toBe(400)
      expect(mockValidateDeploymentAuth).not.toHaveBeenCalled()
      expect(mockSetDeploymentAuthCookie).not.toHaveBeenCalled()
    }
  )

  it('returns 401 on a wrong password without setting a cookie', async () => {
    mockValidateDeploymentAuth.mockResolvedValueOnce({
      authorized: false,
      error: 'Invalid password',
    })
    const res = await POST(postRequest({ password: 'wrong' }), params())
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('Invalid password')
    expect(mockSetDeploymentAuthCookie).not.toHaveBeenCalled()
  })

  it('returns 429 with Retry-After when password attempts are throttled', async () => {
    mockValidateDeploymentAuth.mockResolvedValueOnce({
      authorized: false,
      error: 'Too many attempts. Please try again later.',
      status: 429,
      retryAfterMs: 60_000,
    })
    const res = await POST(postRequest({ password: 'wrong' }), params())
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('60')
    expect(mockSetDeploymentAuthCookie).not.toHaveBeenCalled()
  })

  it('returns 404 for an unknown, inactive, or archived token', async () => {
    mockResolveActiveInterfaceShareByToken.mockResolvedValueOnce(null)
    const res = await POST(postRequest({ password: 'hunter22' }), params())
    expect(res.status).toBe(404)
    expect(mockSetDeploymentAuthCookie).not.toHaveBeenCalled()
  })

  it('never leaks the interface name or workspace in any response', async () => {
    mockValidateDeploymentAuth.mockResolvedValueOnce({
      authorized: false,
      error: 'Invalid password',
    })
    const res = await POST(postRequest({ password: 'wrong' }), params())
    const body = JSON.stringify(await res.json())
    expect(body).not.toContain('Confidential desk')
    expect(body).not.toContain('ws-secret')
    expect(body).not.toContain('enc:secret')
  })

  it('rejects a body with no password', async () => {
    const res = await POST(postRequest({}), params())
    expect(res.status).toBe(400)
    expect(mockSetDeploymentAuthCookie).not.toHaveBeenCalled()
  })
})
