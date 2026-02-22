/**
 * @vitest-environment node
 */
import { createMockRequest, setupCommonApiMocks } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlerMocks = vi.hoisted(() => ({
  betterAuthGET: vi.fn(),
  betterAuthPOST: vi.fn(),
  ensureAnonymousUserExists: vi.fn(),
  createAnonymousGetSessionResponse: vi.fn(() => ({
    data: {
      user: { id: 'anon' },
      session: { id: 'anon-session' },
    },
  })),
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
  createAnonymousGetSessionResponse: handlerMocks.createAnonymousGetSessionResponse,
}))

describe('auth catch-all route (DISABLE_AUTH get-session)', () => {
  beforeEach(() => {
    vi.resetModules()
    setupCommonApiMocks()
    handlerMocks.betterAuthGET.mockReset()
    handlerMocks.betterAuthPOST.mockReset()
    handlerMocks.ensureAnonymousUserExists.mockReset()
    handlerMocks.createAnonymousGetSessionResponse.mockClear()
  })

  it('returns anonymous session in better-auth response envelope when auth is disabled', async () => {
    vi.doMock('@/lib/core/config/feature-flags', () => ({ isAuthDisabled: true }))

    const req = createMockRequest(
      'GET',
      undefined,
      {},
      'http://localhost:3000/api/auth/get-session'
    )
    const { GET } = await import('@/app/api/auth/[...all]/route')

    const res = await GET(req as any)
    const json = await res.json()

    expect(handlerMocks.ensureAnonymousUserExists).toHaveBeenCalledTimes(1)
    expect(handlerMocks.betterAuthGET).not.toHaveBeenCalled()
    expect(json).toEqual({
      data: {
        user: { id: 'anon' },
        session: { id: 'anon-session' },
      },
    })
  })

  it('delegates to better-auth handler when auth is enabled', async () => {
    vi.doMock('@/lib/core/config/feature-flags', () => ({ isAuthDisabled: false }))

    handlerMocks.betterAuthGET.mockResolvedValueOnce(
      new (await import('next/server')).NextResponse(JSON.stringify({ data: { ok: true } }), {
        headers: { 'content-type': 'application/json' },
      }) as any
    )

    const req = createMockRequest(
      'GET',
      undefined,
      {},
      'http://localhost:3000/api/auth/get-session'
    )
    const { GET } = await import('@/app/api/auth/[...all]/route')

    const res = await GET(req as any)
    const json = await res.json()

    expect(handlerMocks.ensureAnonymousUserExists).not.toHaveBeenCalled()
    expect(handlerMocks.betterAuthGET).toHaveBeenCalledTimes(1)
    expect(json).toEqual({ data: { ok: true } })
  })
})
