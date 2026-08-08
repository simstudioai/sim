/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticateV2ApiKey: vi.fn(),
  checkRateLimitDirect: vi.fn(),
  checkRateLimitDirectOrThrow: vi.fn(),
  listVersions: vi.fn(),
  gate: vi.fn(),
}))

vi.mock('@/lib/workflows/application/list-workflow-versions', () => ({
  listWorkflowVersions: {
    operation: { id: 'workflows.versions.list' },
    execute: mocks.listVersions,
  },
}))
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => ({
  authenticateV2ApiKey: mocks.authenticateV2ApiKey,
  V2ApiKeyUnauthenticatedError: class V2ApiKeyUnauthenticatedError extends Error {},
}))
vi.mock('@/lib/core/rate-limiter', () => ({
  getRateLimit: () => ({ maxTokens: 100, refillRate: 50, refillIntervalMs: 60_000 }),
  RateLimiter: class RateLimiter {
    checkRateLimitDirect = mocks.checkRateLimitDirect
    checkRateLimitDirectOrThrow = mocks.checkRateLimitDirectOrThrow
  },
}))
vi.mock('@/app/api/v2/lib/gate', () => ({ v2ApiGateError: mocks.gate }))

import { GET } from '@/app/api/v2/workflows/[id]/versions/route'

const auth = {
  principal: {
    kind: 'workspace_api_key' as const,
    workspaceId: 'workspace-1',
    keyId: 'workspace-key-1',
  },
  rolloutUserId: 'billing-owner-1',
  rateLimitSubjectIds: ['api-key:workspace-key-1', 'workspace:workspace-1'] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
const context = { params: Promise.resolve({ id: 'workflow-1' }) }

describe('GET /api/v2/workflows/[id]/versions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticateV2ApiKey.mockResolvedValue(auth)
    mocks.gate.mockResolvedValue(null)
    mocks.checkRateLimitDirect.mockResolvedValue({
      allowed: true,
      remaining: 599,
      resetAt: new Date('2026-08-01T01:00:00.000Z'),
    })
    mocks.checkRateLimitDirectOrThrow.mockResolvedValue({
      allowed: true,
      remaining: 99,
      resetAt: new Date('2026-08-01T01:00:00.000Z'),
    })
    mocks.listVersions.mockResolvedValue({
      versions: [
        {
          id: 'version-2',
          version: 2,
          name: 'Production',
          description: null,
          isActive: true,
          createdAt: new Date('2026-08-01T00:00:00.000Z'),
          deployedByName: 'Ada',
          latestOperationStatus: 'active',
        },
      ],
      hasMore: false,
    })
  })

  it('lists versions through canonical workflow authorization', async () => {
    const request = new NextRequest(
      'http://localhost/api/v2/workflows/workflow-1/versions?limit=10'
    )
    const response = await GET(request, context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: [
        {
          id: 'version-2',
          version: 2,
          name: 'Production',
          description: null,
          isActive: true,
          createdAt: '2026-08-01T00:00:00.000Z',
          deployedBy: 'Ada',
          latestOperationStatus: 'active',
        },
      ],
      nextCursor: null,
    })
    expect(mocks.listVersions).toHaveBeenCalledWith({
      principal: auth.principal,
      input: { workflowId: 'workflow-1', limit: 10, afterVersion: undefined },
      request,
    })
  })

  it('rejects malformed cursors before the use case', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/v2/workflows/workflow-1/versions?cursor=bad'),
      context
    )

    expect(response.status).toBe(400)
    expect(mocks.listVersions).not.toHaveBeenCalled()
  })
})
