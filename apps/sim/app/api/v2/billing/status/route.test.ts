/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  checkPreauth: vi.fn(),
  checkOperationRate: vi.fn(),
  gate: vi.fn(),
  execute: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => ({
  authenticateV2ApiKey: mocks.authenticate,
  V2ApiKeyUnauthenticatedError: class V2ApiKeyUnauthenticatedError extends Error {},
}))

vi.mock('@/lib/core/rate-limiter', () => ({
  getRateLimit: () => ({ maxTokens: 100, refillRate: 50, refillIntervalMs: 60_000 }),
  RateLimiter: class RateLimiter {
    checkRateLimitDirect = mocks.checkPreauth
    checkRateLimitDirectOrThrow = mocks.checkOperationRate
  },
}))

vi.mock('@/app/api/v2/lib/gate', () => ({ v2ApiGateError: mocks.gate }))

vi.mock('@/lib/billing/application/get-billing-status', () => ({
  getBillingStatus: { operation: { id: 'billing.status.read' }, execute: mocks.execute },
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { GET } from '@/app/api/v2/billing/status/route'

const auth = {
  principal: { kind: 'workspace_api_key' as const, workspaceId: 'workspace-1', keyId: 'key-1' },
  rolloutUserId: 'billing-owner-1',
  rateLimitSubjectIds: ['api-key:key-1', 'workspace:workspace-1'] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
const result = {
  workspaceId: 'workspace-1',
  period: { start: '2026-07-01T00:00:00.000Z', end: '2026-08-01T00:00:00.000Z' },
  plan: 'team',
  status: 'active' as const,
  credits: { used: 500, limit: 20_000, remaining: 19_500 },
}

describe('GET /api/v2/billing/status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticate.mockResolvedValue(auth)
    mocks.gate.mockResolvedValue(null)
    mocks.checkPreauth.mockResolvedValue({
      allowed: true,
      remaining: 599,
      resetAt: new Date('2026-08-01T01:00:00Z'),
    })
    mocks.checkOperationRate.mockResolvedValue({
      allowed: true,
      remaining: 99,
      resetAt: new Date('2026-08-01T01:00:00Z'),
    })
    mocks.execute.mockResolvedValue(result)
  })

  it('passes only the authenticated principal and requested scope to the use case', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/v2/billing/status?workspaceId=workspace-1'
    )
    const response = await GET(request)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: result })
    expect(mocks.execute).toHaveBeenCalledWith({
      principal: auth.principal,
      input: { workspaceId: 'workspace-1' },
      request,
    })
    expect(response.headers.get('x-ratelimit-limit')).toBe('100')
  })

  it('projects typed workspace-policy errors', async () => {
    mocks.execute.mockRejectedValueOnce(
      new OrchestrationError('forbidden', 'API key is not authorized for this workspace')
    )

    const response = await GET(
      new NextRequest('http://localhost:3000/api/v2/billing/status?workspaceId=workspace-2')
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: { code: 'FORBIDDEN' } })
  })

  it('hides unknown billing infrastructure errors', async () => {
    mocks.execute.mockRejectedValueOnce(new Error('stripe account details'))

    const response = await GET(new NextRequest('http://localhost:3000/api/v2/billing/status'))

    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
  })
})
