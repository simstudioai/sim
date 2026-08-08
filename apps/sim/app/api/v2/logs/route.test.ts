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

vi.mock('@/lib/logs/application/list-public-logs', () => ({
  listPublicLogs: { operation: { id: 'logs.list' }, execute: mocks.execute },
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { GET } from '@/app/api/v2/logs/route'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'
const auth = {
  principal: {
    kind: 'workspace_api_key' as const,
    workspaceId: WORKSPACE_ID,
    keyId: 'key-1',
  },
  rolloutUserId: 'billing-owner-1',
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
const log = {
  executionId: 'run-1',
  workflowId: 'workflow-1',
  workspaceId: WORKSPACE_ID,
  deploymentVersionId: null,
  status: 'completed',
  level: 'info',
  trigger: 'api',
  startedAt: new Date('2026-08-06T00:00:00Z'),
  endedAt: new Date('2026-08-06T00:00:01Z'),
  totalDurationMs: 1000,
  costTotal: null,
  files: null,
  workflowName: 'Support Agent',
  workflowDescription: null,
  workflowArchivedAt: null,
}

describe('GET /api/v2/logs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticate.mockResolvedValue(auth)
    mocks.gate.mockResolvedValue(null)
    mocks.checkPreauth.mockResolvedValue({
      allowed: true,
      remaining: 599,
      resetAt: new Date('2026-08-06T01:00:00Z'),
    })
    mocks.checkOperationRate.mockResolvedValue({
      allowed: true,
      remaining: 99,
      resetAt: new Date('2026-08-06T01:00:00Z'),
    })
    mocks.execute.mockResolvedValue({
      items: [{ log, executionData: { finalOutput: false, traceSpans: [] } }],
      nextCursor: null,
      includeFullDetails: true,
      includeFinalOutput: true,
      includeTraceSpans: true,
    })
  })

  it('maps filters into the application operation and preserves diagnostic fields', async () => {
    const request = new NextRequest(
      `http://localhost:3000/api/v2/logs?workspaceId=${WORKSPACE_ID}&includeFinalOutput=true&includeTraceSpans=true`
    )
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data[0]).toMatchObject({
      runId: 'run-1',
      workflow: { name: 'Support Agent' },
      finalOutput: false,
      traceSpans: [],
    })
    expect(mocks.execute).toHaveBeenCalledWith({
      principal: auth.principal,
      input: expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        includeFinalOutput: true,
        includeTraceSpans: true,
      }),
      request,
    })
  })

  it('rejects malformed cursors after admission and before protected reads', async () => {
    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/logs?workspaceId=${WORKSPACE_ID}&cursor=not-a-cursor`
      )
    )

    expect(response.status).toBe(400)
    expect(mocks.authenticate).toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('projects typed folder errors', async () => {
    mocks.execute.mockRejectedValueOnce(new OrchestrationError('not_found', 'Folder not found'))

    const response = await GET(
      new NextRequest(`http://localhost:3000/api/v2/logs?workspaceId=${WORKSPACE_ID}`)
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } })
  })
})
