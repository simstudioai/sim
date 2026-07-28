/**
 * @vitest-environment node
 *
 * Pins the rate-limit headers every v1 endpoint publishes. `X-RateLimit-Limit`
 * and `X-RateLimit-Remaining` must describe the same quantity — the token
 * bucket's capacity and the tokens left in it — or a client computing
 * `used = limit - remaining` gets a negative number.
 */

import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'

const { mockAuthenticateV1Request, mockGetSubscription, mockCheckRateLimit, mockGetRateLimit } =
  vi.hoisted(() => ({
    mockAuthenticateV1Request: vi.fn(),
    mockGetSubscription: vi.fn(),
    mockCheckRateLimit: vi.fn(),
    mockGetRateLimit: vi.fn(),
  }))

vi.mock('@/app/api/v1/auth', () => ({
  authenticateV1Request: mockAuthenticateV1Request,
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  getHighestPrioritySubscription: mockGetSubscription,
}))

vi.mock('@/lib/core/rate-limiter', () => ({
  getRateLimit: mockGetRateLimit,
  RateLimiter: class {
    checkRateLimitWithSubscription = mockCheckRateLimit
  },
}))

import {
  checkRateLimit,
  createRateLimitResponse,
  rateLimitHeaders,
  v1ValidationErrorResponse,
} from '@/app/api/v1/middleware'

/** Mirrors `createBucketConfig`: capacity is the per-minute rate x burst multiplier. */
const TEAM_BUCKET = { maxTokens: 400, refillRate: 200, refillIntervalMs: 60_000 }

function request() {
  return createMockRequest('GET', undefined, {}, 'http://localhost:3000/api/v1/workflows')
}

describe('checkRateLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthenticateV1Request.mockResolvedValue({
      authenticated: true,
      userId: 'user-1',
      keyType: 'personal',
    })
    mockGetSubscription.mockResolvedValue({ plan: 'team' })
    mockGetRateLimit.mockReturnValue(TEAM_BUCKET)
    mockCheckRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 399,
      resetAt: new Date('2026-07-28T18:28:48.354Z'),
    })
  })

  it('reports the bucket capacity as the limit, not the refill rate', async () => {
    const result = await checkRateLimit(request(), 'workflows')

    expect(result.limit).toBe(TEAM_BUCKET.maxTokens)
    expect(result.limit).not.toBe(TEAM_BUCKET.refillRate)
  })

  it('never reports more remaining than the limit', async () => {
    const result = await checkRateLimit(request(), 'workflows')

    expect(result.remaining).toBeLessThanOrEqual(result.limit)
  })

  it('reports a zero limit when authentication fails, since no bucket was consulted', async () => {
    mockAuthenticateV1Request.mockResolvedValue({
      authenticated: false,
      error: 'API key required',
    })

    const result = await checkRateLimit(request(), 'workflows')

    expect(result.allowed).toBe(false)
    expect(result.limit).toBe(0)
    expect(result.error).toBe('API key required')
    expect(mockCheckRateLimit).not.toHaveBeenCalled()
  })

  it('reports a zero limit when the checker itself throws', async () => {
    mockCheckRateLimit.mockRejectedValue(new Error('redis down'))

    const result = await checkRateLimit(request(), 'workflows')

    expect(result.allowed).toBe(false)
    expect(result.limit).toBe(0)
  })
})

describe('createRateLimitResponse', () => {
  const throttled = {
    allowed: false,
    remaining: 0,
    limit: 400,
    resetAt: new Date('2026-07-28T18:28:48.354Z'),
    retryAfterMs: 30_000,
  }

  it('publishes consistent headers on a 429', () => {
    const response = createRateLimitResponse(throttled)

    expect(response.status).toBe(429)
    const limit = Number(response.headers.get('X-RateLimit-Limit'))
    const remaining = Number(response.headers.get('X-RateLimit-Remaining'))
    expect(remaining).toBeLessThanOrEqual(limit)
    expect(response.headers.get('X-RateLimit-Reset')).toBe(throttled.resetAt.toISOString())
    expect(response.headers.get('Retry-After')).toBe('30')
  })

  it('omits rate-limit headers on an auth failure, which never reached the bucket', async () => {
    const response = createRateLimitResponse({
      allowed: false,
      remaining: 0,
      limit: 0,
      resetAt: new Date(),
      error: 'API key required',
    })

    expect(response.status).toBe(401)
    expect(response.headers.get('X-RateLimit-Limit')).toBeNull()
    expect(response.headers.get('X-RateLimit-Remaining')).toBeNull()
    expect(response.headers.get('X-RateLimit-Reset')).toBeNull()
    await expect(response.json()).resolves.toEqual({ error: 'API key required' })
  })
})

describe('rateLimitHeaders', () => {
  it('reports a consistent limit/remaining pair', () => {
    const headers = rateLimitHeaders({
      allowed: true,
      remaining: 399,
      limit: 400,
      resetAt: new Date('2026-07-28T18:28:48.354Z'),
    })

    expect(headers['X-RateLimit-Limit']).toBe('400')
    expect(headers['X-RateLimit-Remaining']).toBe('399')
    expect(Number(headers['X-RateLimit-Remaining'])).toBeLessThanOrEqual(
      Number(headers['X-RateLimit-Limit'])
    )
    expect(headers['X-RateLimit-Reset']).toBe('2026-07-28T18:28:48.354Z')
  })

  it('publishes nothing when no bucket was consulted', () => {
    expect(
      rateLimitHeaders({
        allowed: false,
        remaining: 0,
        limit: 0,
        resetAt: new Date(),
        error: 'API key required',
      })
    ).toEqual({})
  })
})

describe('v1ValidationErrorResponse', () => {
  it('surfaces the schema message instead of a generic string', async () => {
    const schema = z.object({ workspaceId: workspaceIdSchema })
    const parsed = schema.safeParse({})

    const response = v1ValidationErrorResponse(parsed.error!)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('Workspace ID is required')
    expect(body.error).not.toBe('Validation error')
    expect(Array.isArray(body.details)).toBe(true)
  })

  it('keeps the issue list alongside the message', async () => {
    const schema = z.object({ workspaceId: workspaceIdSchema })
    const body = await v1ValidationErrorResponse(schema.safeParse({}).error!).json()

    expect(body.details[0].path).toEqual(['workspaceId'])
  })
})
