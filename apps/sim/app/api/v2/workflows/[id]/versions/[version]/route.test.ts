/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticateV2ApiKey: vi.fn(),
  checkRateLimitDirect: vi.fn(),
  checkRateLimitDirectOrThrow: vi.fn(),
  readVersion: vi.fn(),
  gate: vi.fn(),
}))

vi.mock('@/lib/workflows/application/read-workflow-version', () => ({
  readWorkflowVersion: {
    operation: { id: 'workflows.versions.read' },
    execute: mocks.readVersion,
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

import { GET } from '@/app/api/v2/workflows/[id]/versions/[version]/route'

const auth = {
  principal: {
    kind: 'personal_api_key' as const,
    userId: 'user-1',
    keyId: 'personal-key-1',
  },
  rolloutUserId: 'user-1',
  rateLimitSubjectIds: ['api-key:personal-key-1', 'user:user-1'] as const,
  rateLimitSubscription: null,
  keyType: 'personal' as const,
}

describe('GET /api/v2/workflows/[id]/versions/[version]', () => {
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
    mocks.readVersion.mockResolvedValue({
      version: {
        id: 'version-2',
        version: 2,
        name: 'Production',
        description: null,
        isActive: true,
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        state: { blocks: {}, edges: [], loops: {}, parallels: {}, version: '1.0' },
      },
    })
  })

  it('reads the requested version through the semantic use case', async () => {
    const request = new NextRequest('http://localhost/api/v2/workflows/workflow-1/versions/2')
    const response = await GET(request, {
      params: Promise.resolve({ id: 'workflow-1', version: '2' }),
    })

    expect(response.status).toBe(200)
    expect((await response.json()).data).toMatchObject({ id: 'version-2', version: 2 })
    expect(mocks.readVersion).toHaveBeenCalledWith({
      principal: auth.principal,
      input: { workflowId: 'workflow-1', version: 2 },
      request,
    })
  })
})
