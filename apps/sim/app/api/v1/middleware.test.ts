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
import {
  buildRateLimitHeaders,
  getRateLimitHeaders,
  recordRateLimitSnapshot,
} from '@/lib/api/server/rate-limit-context'

const {
  mockAuthenticateV1Request,
  mockGetSubscription,
  mockCheckRateLimit,
  mockGetRateLimit,
  mockResolveSystemBillingAttribution,
  mockToUsageLimitSubscription,
  mockGetUserEntityPermissions,
} = vi.hoisted(() => ({
  mockAuthenticateV1Request: vi.fn(),
  mockGetSubscription: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockGetRateLimit: vi.fn(),
  mockResolveSystemBillingAttribution: vi.fn(),
  mockToUsageLimitSubscription: vi.fn(),
  mockGetUserEntityPermissions: vi.fn(),
}))

vi.mock('@/app/api/v1/auth', () => ({
  authenticateV1Request: mockAuthenticateV1Request,
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  getHighestPrioritySubscription: mockGetSubscription,
}))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  resolveSystemBillingAttribution: mockResolveSystemBillingAttribution,
  toUsageLimitSubscription: mockToUsageLimitSubscription,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))

vi.mock('@/lib/core/rate-limiter', () => ({
  getRateLimit: mockGetRateLimit,
  RateLimiter: class {
    checkRateLimitWithSubscription = mockCheckRateLimit
  },
}))

import {
  authenticateRequest,
  checkRateLimit,
  createRateLimitResponse,
  v1ValidationErrorResponse,
} from '@/app/api/v1/middleware'

/** Mirrors `createBucketConfig`: capacity is the per-minute rate x burst multiplier. */
const TEAM_BUCKET = { maxTokens: 400, refillRate: 200, refillIntervalMs: 60_000 }

function request() {
  return createMockRequest('GET', undefined, {}, 'http://localhost:3000/api/v1/workflows')
}

function v2Request() {
  return createMockRequest('GET', undefined, {}, 'http://localhost:3000/api/v2/workflows')
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

describe('v2 attribution', () => {
  const BILLING_ATTRIBUTION = {
    actorUserId: 'billing-actor',
    workspaceId: 'workspace-1',
    organizationId: 'organization-1',
    billedAccountUserId: 'billing-actor',
    billingEntity: { type: 'organization', id: 'organization-1' },
    billingPeriod: {
      start: '2026-07-01T00:00:00.000Z',
      end: '2026-08-01T00:00:00.000Z',
    },
    payerSubscription: null,
  }
  const WORKSPACE_SUBSCRIPTION = { plan: 'team', referenceId: 'organization-1' }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRateLimit.mockReturnValue(TEAM_BUCKET)
    mockCheckRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 399,
      resetAt: new Date('2026-07-28T18:28:48.354Z'),
    })
    mockGetUserEntityPermissions.mockResolvedValue('read')
    mockResolveSystemBillingAttribution.mockResolvedValue(BILLING_ATTRIBUTION)
    mockToUsageLimitSubscription.mockReturnValue(WORKSPACE_SUBSCRIPTION)
  })

  it('keeps a personal key owner as both principal and actor', async () => {
    mockAuthenticateV1Request.mockResolvedValue({
      authenticated: true,
      userId: 'person-1',
      keyId: 'key-personal',
      keyType: 'personal',
    })
    const personalSubscription = { plan: 'pro', referenceId: 'person-1' }
    mockGetSubscription.mockResolvedValue(personalSubscription)

    const result = await checkRateLimit(v2Request(), 'workflows')

    expect(result).toMatchObject({
      userId: 'person-1',
      principalUserId: 'person-1',
      keyId: 'key-personal',
      keyType: 'personal',
    })
    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      'person-1',
      personalSubscription,
      'api-endpoint',
      false
    )
    expect(mockResolveSystemBillingAttribution).not.toHaveBeenCalled()
  })

  it('uses the exact workspace billing actor and payer without reading the creator subscription', async () => {
    mockAuthenticateV1Request.mockResolvedValue({
      authenticated: true,
      userId: 'key-creator',
      keyId: 'key-workspace',
      keyType: 'workspace',
      workspaceId: 'workspace-1',
    })

    const result = await checkRateLimit(v2Request(), 'workflows')

    expect(mockGetUserEntityPermissions).toHaveBeenCalledWith(
      'key-creator',
      'workspace',
      'workspace-1'
    )
    expect(mockGetSubscription).not.toHaveBeenCalled()
    expect(mockResolveSystemBillingAttribution).toHaveBeenCalledWith('workspace-1')
    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      'billing-actor',
      WORKSPACE_SUBSCRIPTION,
      'api-endpoint',
      false
    )
    expect(result).toMatchObject({
      userId: 'billing-actor',
      principalUserId: 'key-creator',
      keyId: 'key-workspace',
      workspaceId: 'workspace-1',
      keyType: 'workspace',
      billingAttribution: BILLING_ATTRIBUTION,
      v2WorkspaceKeyAuthorized: true,
    })
  })

  it('rejects a workspace key after its creator loses workspace membership', async () => {
    mockAuthenticateV1Request.mockResolvedValue({
      authenticated: true,
      userId: 'former-member',
      keyId: 'key-workspace',
      keyType: 'workspace',
      workspaceId: 'workspace-1',
    })
    mockGetUserEntityPermissions.mockResolvedValue(null)

    const result = await checkRateLimit(v2Request(), 'workflows')

    expect(result).toMatchObject({ allowed: false, limit: 0, error: 'Invalid API key' })
    expect(mockResolveSystemBillingAttribution).not.toHaveBeenCalled()
    expect(mockCheckRateLimit).not.toHaveBeenCalled()
  })
})

describe('authenticateRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthenticateV1Request.mockResolvedValue({
      authenticated: true,
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

  it('fails fast when an allowed result has no user ID', async () => {
    await expect(authenticateRequest(request(), 'workflows')).rejects.toThrow(
      'Allowed public API request is missing a user ID'
    )
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

describe('v1ValidationErrorResponse', () => {
  it('surfaces the schema message instead of a generic string', async () => {
    const schema = z.object({ workspaceId: workspaceIdSchema })
    const parsed = schema.safeParse({})

    const response = v1ValidationErrorResponse(parsed.error!)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('Workspace ID is required')
    expect(Array.isArray(body.details)).toBe(true)
  })

  it('keeps the issue list alongside the message', async () => {
    const schema = z.object({ workspaceId: workspaceIdSchema })
    const body = await v1ValidationErrorResponse(schema.safeParse({}).error!).json()

    expect(body.details[0].path).toEqual(['workspaceId'])
  })
})

describe('rate-limit snapshot context', () => {
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

  const SNAPSHOT = {
    limit: 400,
    remaining: 399,
    resetAt: new Date('2026-07-28T18:28:48.354Z'),
  }

  it('builds a consistent limit/remaining pair', () => {
    const headers = buildRateLimitHeaders(SNAPSHOT)

    expect(headers['X-RateLimit-Limit']).toBe('400')
    expect(headers['X-RateLimit-Remaining']).toBe('399')
    expect(Number(headers['X-RateLimit-Remaining'])).toBeLessThanOrEqual(
      Number(headers['X-RateLimit-Limit'])
    )
    expect(headers['X-RateLimit-Reset']).toBe('2026-07-28T18:28:48.354Z')
  })

  it('returns null for a request that never consulted a bucket', () => {
    expect(getRateLimitHeaders({})).toBeNull()
  })

  it('returns the headers once a snapshot is recorded for that request', () => {
    const req = {}
    recordRateLimitSnapshot(req, SNAPSHOT)

    expect(getRateLimitHeaders(req)).toEqual(buildRateLimitHeaders(SNAPSHOT))
  })

  it('keeps snapshots per request, not global', () => {
    const a = {}
    const b = {}
    recordRateLimitSnapshot(a, SNAPSHOT)

    expect(getRateLimitHeaders(a)).not.toBeNull()
    expect(getRateLimitHeaders(b)).toBeNull()
  })

  it('records a snapshot as a side effect of checkRateLimit', async () => {
    const req = request()

    await checkRateLimit(req, 'workflows')

    const headers = getRateLimitHeaders(req)
    expect(headers).not.toBeNull()
    expect(headers?.['X-RateLimit-Limit']).toBe(String(TEAM_BUCKET.maxTokens))
  })

  it('records nothing when authentication fails', async () => {
    mockAuthenticateV1Request.mockResolvedValue({ authenticated: false, error: 'API key required' })
    const req = request()

    await checkRateLimit(req, 'workflows')

    expect(getRateLimitHeaders(req)).toBeNull()
  })
})
