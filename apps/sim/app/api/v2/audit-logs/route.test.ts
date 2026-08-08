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
  list: vi.fn(),
  get: vi.fn(),
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

vi.mock('@/lib/audit-logs/application/list-audit-logs', () => ({
  listAuditLogs: { operation: { id: 'audit_logs.list' }, execute: mocks.list },
}))

vi.mock('@/lib/audit-logs/application/get-audit-log', () => ({
  getAuditLog: { operation: { id: 'audit_logs.read_detail' }, execute: mocks.get },
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { GET as getDetail } from '@/app/api/v2/audit-logs/[id]/route'
import { GET as listLogs } from '@/app/api/v2/audit-logs/route'

const auth = {
  principal: { kind: 'personal_api_key' as const, userId: 'admin-1', keyId: 'key-1' },
  rolloutUserId: 'admin-1',
  rateLimitSubjectIds: ['api-key:key-1', 'user:admin-1'] as const,
  rateLimitSubscription: null,
  keyType: 'personal' as const,
}
const log = {
  id: 'audit-1',
  workspaceId: 'workspace-1',
  actorId: 'admin-1',
  actorName: 'Ada',
  actorEmail: 'ada@example.com',
  action: 'workspace.updated',
  resourceType: 'workspace',
  resourceId: 'workspace-1',
  resourceName: 'Engineering',
  description: null,
  metadata: {},
  createdAt: new Date('2026-08-01T00:00:00Z'),
  ipAddress: null,
  userAgent: null,
}

describe('v2 audit-log routes', () => {
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
    mocks.list.mockResolvedValue({ data: [log], nextCursor: 'next-1' })
    mocks.get.mockResolvedValue({ log })
  })

  it('authenticates and rate-limits before validating organization input', async () => {
    const response = await listLogs(new NextRequest('http://localhost:3000/api/v2/audit-logs'))

    expect(response.status).toBe(400)
    expect(mocks.authenticate).toHaveBeenCalled()
    expect(mocks.checkOperationRate).toHaveBeenCalledTimes(2)
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('maps list filters into the authorized application operation', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/v2/audit-logs?organizationId=org-1&actorEmail=ada%40example.com'
    )
    const response = await listLogs(request)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: [{ id: 'audit-1' }], nextCursor: 'next-1' })
    expect(mocks.list).toHaveBeenCalledWith({
      principal: auth.principal,
      input: expect.objectContaining({
        organizationId: 'org-1',
        filters: expect.objectContaining({ actorEmail: 'ada@example.com' }),
      }),
      request,
    })
    expect(response.headers.get('x-ratelimit-limit')).toBe('100')
  })

  it('projects typed admin-policy failures without leaking internals', async () => {
    mocks.list.mockRejectedValueOnce(new OrchestrationError('forbidden', 'Admin required'))

    const response = await listLogs(
      new NextRequest('http://localhost:3000/api/v2/audit-logs?organizationId=org-1')
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: { code: 'FORBIDDEN' } })
  })

  it('keeps the detail envelope independent', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/v2/audit-logs/audit-1?organizationId=org-1'
    )
    const response = await getDetail(request, {
      params: Promise.resolve({ id: 'audit-1' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: { id: 'audit-1' } })
    expect(mocks.get).toHaveBeenCalledWith({
      principal: auth.principal,
      input: { id: 'audit-1', organizationId: 'org-1' },
      request,
    })
  })
})
