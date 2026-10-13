/**
 * @vitest-environment node
 */
import { authMockFns, createMockRequest, requestUtilsMockFns } from '@sim/testing'
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

/** Upper bound on requests a test sends while draining a bucket. */
const DRAIN_CAP = 1_000

async function mintAs(userId: string | null, ip: string) {
  requestUtilsMockFns.mockGetClientIp.mockReturnValue(ip)
  authMockFns.mockGetSession.mockResolvedValue(userId ? { user: { id: userId } } : null)
  return POST(createMockRequest('POST'))
}

async function drainUntilRateLimited(send: (attempt: number) => Promise<Response>) {
  for (let attempt = 0; attempt < DRAIN_CAP; attempt++) {
    const response = await send(attempt)
    if (response.status === 429) return response
  }
  throw new Error(`no 429 within ${DRAIN_CAP} requests`)
}

describe('POST /api/auth/socket-token', () => {
  beforeEach(() => {
    buckets.clear()
    authMockFns.mockGenerateOneTimeToken.mockResolvedValue({ token: 'one-time-token' })
  })

  it('rate-limits a user across addresses and answers 429 with Retry-After', async () => {
    const limited = await drainUntilRateLimited((attempt) =>
      mintAs('user-a', `198.51.100.${attempt % 250}`)
    )

    expect(limited.headers.get('retry-after')).toMatch(/^\d+$/)
    authMockFns.mockGenerateOneTimeToken.mockClear()

    expect((await mintAs('user-a', '192.0.2.77')).status).toBe(429)
    expect(authMockFns.mockGenerateOneTimeToken).not.toHaveBeenCalled()
  })

  it('gives two users behind one address separate budgets', async () => {
    const officeIp = '203.0.113.10'
    await drainUntilRateLimited(() => mintAs('user-a', officeIp))

    const other = await mintAs('user-b', officeIp)

    expect(other.status).toBe(200)
    expect(await other.json()).toEqual({ token: 'one-time-token' })
  })

  it('answers 401 without minting, then 429s an address over the backstop before any session lookup', async () => {
    const attackerIp = '192.0.2.200'
    const first = await mintAs(null, attackerIp)
    expect(first.status).toBe(401)

    const limited = await drainUntilRateLimited(async () => {
      const response = await mintAs(null, attackerIp)
      if (response.status !== 429) expect(response.status).toBe(401)
      return response
    })
    expect(limited.headers.get('retry-after')).toMatch(/^\d+$/)
    expect(authMockFns.mockGenerateOneTimeToken).not.toHaveBeenCalled()

    authMockFns.mockGetSession.mockClear()
    expect((await mintAs(null, attackerIp)).status).toBe(429)
    expect(authMockFns.mockGetSession).not.toHaveBeenCalled()
  })
})
