/**
 * @vitest-environment node
 */
import { createMockRequest, resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const handlerMocks = vi.hoisted(() => ({
  betterAuthGET: vi.fn(),
  betterAuthPOST: vi.fn(),
  ensureAnonymousUserExists: vi.fn(),
  createAnonymousSession: vi.fn(() => ({
    user: { id: 'anon' },
    session: { id: 'anon-session' },
  })),
  withSSOCallbackIntent: vi.fn((_providerId: string, callback: () => Promise<unknown>) =>
    callback()
  ),
}))

vi.mock('@/lib/auth/sso/provider-operation-intent', () => ({
  withSSOCallbackIntent: handlerMocks.withSSOCallbackIntent,
}))

vi.mock('better-auth/next-js', () => ({
  toNextJsHandler: () => ({
    GET: handlerMocks.betterAuthGET,
    POST: handlerMocks.betterAuthPOST,
  }),
}))

vi.mock('@/lib/auth', () => ({
  auth: { handler: {} },
}))

vi.mock('@/lib/auth/anonymous', () => ({
  ensureAnonymousUserExists: handlerMocks.ensureAnonymousUserExists,
  createAnonymousSession: handlerMocks.createAnonymousSession,
}))

import { GET, POST } from '@/app/api/auth/[...all]/route'

afterAll(resetEnvFlagsMock)

describe('auth catch-all route (DISABLE_AUTH get-session)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setEnvFlags({ isAuthDisabled: false })
  })

  it('returns anonymous session in better-auth response envelope when auth is disabled', async () => {
    setEnvFlags({ isAuthDisabled: true })

    const req = createMockRequest(
      'GET',
      undefined,
      {},
      'http://localhost:3000/api/auth/get-session'
    )

    const res = await GET(req as any)
    const json = await res.json()

    expect(handlerMocks.ensureAnonymousUserExists).toHaveBeenCalledTimes(1)
    expect(handlerMocks.betterAuthGET).not.toHaveBeenCalled()
    expect(json).toEqual({
      user: { id: 'anon' },
      session: { id: 'anon-session' },
    })
  })

  it('delegates to better-auth handler when auth is enabled', async () => {
    setEnvFlags({ isAuthDisabled: false })

    const { NextResponse } = await import('next/server')
    handlerMocks.betterAuthGET.mockResolvedValueOnce(
      new NextResponse(JSON.stringify({ data: { ok: true } }), {
        headers: { 'content-type': 'application/json' },
      }) as any
    )

    const req = createMockRequest(
      'GET',
      undefined,
      {},
      'http://localhost:3000/api/auth/get-session'
    )

    const res = await GET(req as any)
    const json = await res.json()

    expect(handlerMocks.ensureAnonymousUserExists).not.toHaveBeenCalled()
    expect(handlerMocks.betterAuthGET).toHaveBeenCalledTimes(1)
    expect(json).toEqual({ data: { ok: true } })
  })
})

describe('auth catch-all route organization mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('blocks Better Auth organization mutation endpoints that bypass app lifecycle rules', async () => {
    const req = createMockRequest(
      'POST',
      undefined,
      {},
      'http://localhost:3000/api/auth/organization/create'
    )

    const res = await POST(req as any)
    const json = await res.json()

    expect(res.status).toBe(404)
    expect(handlerMocks.betterAuthPOST).not.toHaveBeenCalled()
    expect(json).toEqual({
      error: 'Organization mutations are handled by application API routes.',
    })
  })

  it('allows safe Better Auth organization session endpoints', async () => {
    const { NextResponse } = await import('next/server')
    handlerMocks.betterAuthPOST.mockResolvedValueOnce(
      new NextResponse(JSON.stringify({ data: { ok: true } }), {
        headers: { 'content-type': 'application/json' },
      }) as any
    )

    const req = createMockRequest(
      'POST',
      undefined,
      {},
      'http://localhost:3000/api/auth/organization/set-active'
    )

    const res = await POST(req as any)
    const json = await res.json()

    expect(handlerMocks.betterAuthPOST).toHaveBeenCalledTimes(1)
    expect(json).toEqual({ data: { ok: true } })
  })
})

describe('auth catch-all route SSO mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    'register',
    'update-provider',
    'delete-provider',
    'request-domain-verification',
    'verify-domain',
  ])('blocks the raw Better Auth /sso/%s endpoint', async (path) => {
    const req = createMockRequest(
      'POST',
      undefined,
      {},
      `http://localhost:3000/api/auth/sso/${path}`
    )
    const res = await POST(req as any)

    expect(res.status).toBe(404)
    expect(handlerMocks.betterAuthPOST).not.toHaveBeenCalled()
  })

  it('continues to delegate non-mutation SSO endpoints', async () => {
    const { NextResponse } = await import('next/server')
    handlerMocks.betterAuthPOST.mockResolvedValueOnce(
      new NextResponse(null, { status: 200 }) as any
    )
    const req = createMockRequest(
      'POST',
      undefined,
      {},
      'http://localhost:3000/api/auth/sign-in/sso'
    )

    const res = await POST(req as any)
    expect(res.status).toBe(200)
    expect(handlerMocks.betterAuthPOST).toHaveBeenCalledTimes(1)
    expect(handlerMocks.withSSOCallbackIntent).not.toHaveBeenCalled()
  })

  it('registers an intent around OIDC GET callbacks', async () => {
    const { NextResponse } = await import('next/server')
    handlerMocks.betterAuthGET.mockResolvedValueOnce(new NextResponse(null, { status: 302 }) as any)
    const req = createMockRequest(
      'GET',
      undefined,
      {},
      'http://localhost:3000/api/auth/sso/callback/acme'
    )

    const res = await GET(req as any)

    expect(res.status).toBe(302)
    expect(handlerMocks.withSSOCallbackIntent).toHaveBeenCalledWith('acme', expect.any(Function))
    expect(handlerMocks.betterAuthGET).toHaveBeenCalledTimes(1)
  })

  it('registers an intent around SAML POST callbacks', async () => {
    const { NextResponse } = await import('next/server')
    handlerMocks.betterAuthPOST.mockResolvedValueOnce(
      new NextResponse(null, { status: 302 }) as any
    )
    const req = createMockRequest(
      'POST',
      undefined,
      {},
      'http://localhost:3000/api/auth/sso/saml2/callback/acme'
    )

    const res = await POST(req as any)

    expect(res.status).toBe(302)
    expect(handlerMocks.withSSOCallbackIntent).toHaveBeenCalledWith('acme', expect.any(Function))
    expect(handlerMocks.betterAuthPOST).toHaveBeenCalledTimes(1)
  })
})
