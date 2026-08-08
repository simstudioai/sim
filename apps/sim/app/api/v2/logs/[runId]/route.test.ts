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

vi.mock('@/lib/logs/application/get-public-log', () => ({
  getPublicLog: { operation: { id: 'logs.read_detail' }, execute: mocks.execute },
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { GET } from '@/app/api/v2/logs/[runId]/route'

const auth = {
  principal: {
    kind: 'workspace_api_key' as const,
    workspaceId: 'workspace-1',
    keyId: 'key-1',
  },
  rolloutUserId: 'billing-owner-1',
  rateLimitSubjectIds: ['api-key:key-1', 'workspace:workspace-1'] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
const log = {
  executionId: 'run-1',
  workflowId: 'workflow-1',
  deploymentVersionId: 'deployment-1',
  status: 'completed',
  level: 'info',
  trigger: 'api',
  startedAt: new Date('2026-08-06T00:00:00Z'),
  endedAt: new Date('2026-08-06T00:00:01Z'),
  totalDurationMs: 1000,
  files: null,
  workflowName: 'Support Agent',
  workflowDescription: null,
  workflowOwnerEmail: 'owner@example.com',
  workflowWorkspaceId: 'workspace-1',
  workflowCreatedAt: new Date('2026-01-01T00:00:00Z'),
  workflowUpdatedAt: new Date('2026-01-02T00:00:00Z'),
  workflowArchivedAt: null,
  workflowState: { blocks: {}, edges: [] },
  costTotal: '0.01',
  createdAt: new Date('2026-08-06T00:00:00Z'),
}

describe('GET /api/v2/logs/[runId]', () => {
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
      log,
      workflowFolderPath: '/agents',
      executionData: { traceSpans: [], finalOutput: { ok: true } },
    })
  })

  it('uses runId as the sole asserted identity', async () => {
    const request = new NextRequest('http://localhost:3000/api/v2/logs/run-1')
    const response = await GET(request, { params: Promise.resolve({ runId: 'run-1' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toMatchObject({
      runId: 'run-1',
      workflow: { folderPath: '/agents', ownerEmail: 'owner@example.com' },
      finalOutput: { ok: true },
    })
    expect(body.data).not.toHaveProperty('executionData')
    expect(mocks.execute).toHaveBeenCalledWith({
      principal: auth.principal,
      input: { runId: 'run-1' },
      request,
    })
  })

  it('conceals canonical workspace authorization as log not-found', async () => {
    mocks.execute.mockRejectedValueOnce(
      new OrchestrationError('forbidden', 'Workspace API key cannot perform this operation')
    )

    const response = await GET(new NextRequest('http://localhost:3000/api/v2/logs/run-1'), {
      params: Promise.resolve({ runId: 'run-1' }),
    })

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({
      error: { code: 'NOT_FOUND', message: 'Log not found' },
    })
  })

  it('hides unexpected materialization errors', async () => {
    mocks.execute.mockRejectedValueOnce(new Error('storage key details'))

    const response = await GET(new NextRequest('http://localhost:3000/api/v2/logs/run-1'), {
      params: Promise.resolve({ runId: 'run-1' }),
    })

    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
  })
})
