/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockCreateSession, mockCreateVerificationValue, mockEnforceIpRateLimit } =
  vi.hoisted(() => ({
    mockGetSession: vi.fn(),
    mockCreateSession: vi.fn(),
    mockCreateVerificationValue: vi.fn(),
    mockEnforceIpRateLimit: vi.fn(),
  }))

vi.mock('@/lib/auth', () => ({
  auth: {
    api: { getSession: mockGetSession },
    $context: Promise.resolve({
      internalAdapter: {
        createSession: mockCreateSession,
        createVerificationValue: mockCreateVerificationValue,
      },
    }),
  },
  getSession: vi.fn(),
}))

vi.mock('@/lib/core/rate-limiter', () => ({
  enforceIpRateLimit: mockEnforceIpRateLimit,
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}))

import { POST } from '@/app/api/desktop/auth/handoff/route'

const BROWSER_SESSION_TOKEN = 'browser-session-token'
const DESKTOP_SESSION_TOKEN = 'desktop-session-token'

function request() {
  return createMockRequest('POST', undefined, {}, 'http://localhost:3000/api/desktop/auth/handoff')
}

describe('POST /api/desktop/auth/handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnforceIpRateLimit.mockResolvedValue(null)
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { token: BROWSER_SESSION_TOKEN },
    })
    mockCreateSession.mockResolvedValue({ id: 'session-2', token: DESKTOP_SESSION_TOKEN })
  })

  it('binds the token to a NEW session, never the browser session that authorized it', async () => {
    // The whole point of the endpoint: Better Auth's own generateOneTimeToken
    // would bind to the caller's session, making desktop sign-out delete the
    // row the browser is still presenting (and vice versa).
    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(mockCreateSession).toHaveBeenCalledWith('user-1', false, {
      userAgent: 'Sim Desktop',
    })
    expect(mockCreateVerificationValue).toHaveBeenCalledTimes(1)
    const verification = mockCreateVerificationValue.mock.calls[0][0]
    expect(verification.value).toBe(DESKTOP_SESSION_TOKEN)
    expect(verification.value).not.toBe(BROWSER_SESSION_TOKEN)
  })

  it('stores the token where Better Auth one-time-token/verify reads it', async () => {
    const response = await POST(request())
    const { token } = await response.json()

    // The desktop redeems through Better Auth's stock verify endpoint, which
    // looks the row up by this identifier with the token stored verbatim
    // (the plugin's storeToken default is 'plain').
    const verification = mockCreateVerificationValue.mock.calls[0][0]
    expect(verification.identifier).toBe(`one-time-token:${token}`)
    expect(token).toHaveLength(32)
  })

  it('expires the token in minutes, not the plugin-wide 24h', async () => {
    await POST(request())

    const { expiresAt } = mockCreateVerificationValue.mock.calls[0][0]
    const ttlMs = expiresAt.getTime() - Date.now()
    expect(ttlMs).toBeGreaterThan(60 * 1000)
    expect(ttlMs).toBeLessThanOrEqual(10 * 60 * 1000)
  })

  it('reads the session fresh so a cache-only session cannot mint an unredeemable token', async () => {
    await POST(request())
    expect(mockGetSession).toHaveBeenCalledWith(
      expect.objectContaining({ query: { disableCookieCache: true } })
    )
  })

  it('returns 401 without creating a session when the caller is signed out', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await POST(request())

    expect(response.status).toBe(401)
    expect(mockCreateSession).not.toHaveBeenCalled()
    expect(mockCreateVerificationValue).not.toHaveBeenCalled()
  })

  it('surfaces an access-controlled account as 403, not a retry-forever 500', async () => {
    // The app's session.create.before hook throws a Better Auth APIError for
    // blocked emails/domains. That refusal is permanent.
    const blocked = Object.assign(new Error('Access restricted. Contact your administrator.'), {
      statusCode: 403,
    })
    mockCreateSession.mockRejectedValue(blocked)

    const response = await POST(request())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Access restricted. Contact your administrator.',
    })
  })

  it('does not create a session when rate limited', async () => {
    mockEnforceIpRateLimit.mockResolvedValue(
      new Response(null, { status: 429 }) as unknown as Response
    )

    const response = await POST(request())

    expect(response.status).toBe(429)
    expect(mockGetSession).not.toHaveBeenCalled()
    expect(mockCreateSession).not.toHaveBeenCalled()
  })
})

describe('GET /api/desktop/auth/handoff', () => {
  it('is not exposed — a bare navigation must never mint a session-granting token', async () => {
    // state and port are attacker-choosable in a crafted link, and whoever
    // holds the loopback port receives whatever the token redeems to. The mint
    // is reachable only from the explicit Continue gesture, which POSTs.
    const routeModule = await import('@/app/api/desktop/auth/handoff/route')
    expect('GET' in routeModule).toBe(false)
  })
})
