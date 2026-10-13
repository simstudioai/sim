/**
 * @vitest-environment node
 */
import { authMockFns } from '@sim/testing/mocks/auth.mock'
import { createMockRequest, requestUtilsMockFns } from '@sim/testing/mocks/request.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { buckets } = vi.hoisted(() => ({ buckets: new Map<string, number>() }))

/** A token bucket that never refills, so a drained budget stays drained for the test. */
vi.mock('@/lib/core/rate-limiter/storage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/core/rate-limiter/storage')>(
    '@/lib/core/rate-limiter/storage'
  )
  return {
    ...actual,
    createStorageAdapter: () => ({
      consumeTokens: async (key: string, tokens: number, config: { maxTokens: number }) => {
        const used = buckets.get(key) ?? 0
        const resetAt = new Date(Date.now() + 60_000)
        if (used + tokens > config.maxTokens) {
          return { allowed: false, tokensRemaining: 0, resetAt }
        }
        buckets.set(key, used + tokens)
        return { allowed: true, tokensRemaining: config.maxTokens - used - tokens, resetAt }
      },
    }),
  }
})

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}))

import { POST } from '@/app/api/auth/socket-token/route'

/** The route's per-user budget and per-address backstop; a change to either should fail here. */
const USER_BUDGET = 30
const IP_BACKSTOP = 300

async function mintAs(userId: string | null, ip: string) {
  requestUtilsMockFns.mockGetClientIp.mockReturnValue(ip)
  authMockFns.mockGetSession.mockResolvedValue(userId ? { user: { id: userId } } : null)
  return POST(createMockRequest('POST'), { params: Promise.resolve({}) })
}

describe('POST /api/auth/socket-token', () => {
  beforeEach(() => {
    buckets.clear()
    authMockFns.mockGenerateOneTimeToken.mockResolvedValue({ token: 'one-time-token' })
  })

  it('allows a user exactly their budget across addresses, then answers 429 with Retry-After', async () => {
    for (let attempt = 0; attempt < USER_BUDGET; attempt++) {
      expect((await mintAs('user-a', `198.51.100.${attempt}`)).status).toBe(200)
    }
    authMockFns.mockGenerateOneTimeToken.mockClear()

    const limited = await mintAs('user-a', '192.0.2.77')

    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toMatch(/^\d+$/)
    expect(authMockFns.mockGenerateOneTimeToken).not.toHaveBeenCalled()
  })

  it('gives two users behind one address separate budgets', async () => {
    const officeIp = '203.0.113.10'
    for (let attempt = 0; attempt < USER_BUDGET; attempt++) {
      expect((await mintAs('user-a', officeIp)).status).toBe(200)
    }
    expect((await mintAs('user-a', officeIp)).status).toBe(429)

    const other = await mintAs('user-b', officeIp)

    expect(other.status).toBe(200)
    expect(await other.json()).toEqual({ token: 'one-time-token' })
  })

  it('answers 401 without minting up to the backstop, then 429 before any session lookup', async () => {
    const attackerIp = '192.0.2.200'
    for (let attempt = 0; attempt < IP_BACKSTOP; attempt++) {
      expect((await mintAs(null, attackerIp)).status).toBe(401)
    }
    expect(authMockFns.mockGenerateOneTimeToken).not.toHaveBeenCalled()
    authMockFns.mockGetSession.mockClear()

    const limited = await mintAs(null, attackerIp)

    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toMatch(/^\d+$/)
    expect(authMockFns.mockGetSession).not.toHaveBeenCalled()
  })
})
