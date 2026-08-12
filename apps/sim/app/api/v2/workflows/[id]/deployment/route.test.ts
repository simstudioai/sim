/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticateV2ApiKey: vi.fn(),
  checkRateLimitDirect: vi.fn(),
  checkRateLimitDirectOrThrow: vi.fn(),
  resolvePermission: vi.fn(),
  resolveWorkflowContext: vi.fn(),
  getWorkflowDeploymentSummary: vi.fn(),
  checkNeedsRedeployment: vi.fn(),
  gate: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))
vi.mock('@/lib/workflows/application/context', () => ({
  resolveActiveWorkflowApplicationContext: mocks.resolveWorkflowContext,
}))
vi.mock('@/lib/workflows/orchestration/deploy', () => ({
  getWorkflowDeploymentSummary: mocks.getWorkflowDeploymentSummary,
  performActivateVersion: vi.fn(),
  performFullDeploy: vi.fn(),
  performFullUndeploy: vi.fn(),
  performRevertToVersion: vi.fn(),
}))
vi.mock('@/lib/workflows/deployment-status', () => ({
  checkNeedsRedeployment: mocks.checkNeedsRedeployment,
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

import { GET } from '@/app/api/v2/workflows/[id]/deployment/route'

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

const activeDeployment = {
  deploymentVersionId: 'depver-2',
  version: 2,
  deployedAt: '2026-08-01T00:00:00.000Z',
}

const latestDeploymentAttempt = {
  id: 'op-2',
  deploymentVersionId: 'depver-2',
  version: 2,
  action: 'deploy' as const,
  status: 'active' as const,
  isCurrent: true,
  readiness: {
    webhooks: 'not_applicable' as const,
    schedules: 'not_applicable' as const,
    mcp: 'not_applicable' as const,
  },
  requestedAt: '2026-08-01T00:00:00.000Z',
  activatedAt: '2026-08-01T00:00:01.000Z',
  error: null,
}

/**
 * `workflow.deployedAt` carries a stale timestamp from a deployment that was
 * later undeployed — the presenter must never fall back to it.
 */
const workflowContext = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
  workflowId: 'workflow-1',
  workflow: {
    id: 'workflow-1',
    workspaceId: 'workspace-1',
    deployedAt: new Date('2025-01-01T00:00:00.000Z'),
  },
}

async function get() {
  const request = new NextRequest('http://localhost/api/v2/workflows/workflow-1/deployment')
  return GET(request, { params: Promise.resolve({ id: 'workflow-1' }) })
}

describe('GET /api/v2/workflows/[id]/deployment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticateV2ApiKey.mockResolvedValue(auth)
    mocks.gate.mockResolvedValue(null)
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.resolveWorkflowContext.mockResolvedValue(workflowContext)
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
    mocks.getWorkflowDeploymentSummary.mockResolvedValue({
      activeDeployment,
      latestDeploymentAttempt,
      warnings: undefined,
    })
    mocks.checkNeedsRedeployment.mockResolvedValue(true)
  })

  it('publishes draft-versus-live drift and the latest attempt after canonical authorization', async () => {
    const response = await get()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        id: 'workflow-1',
        isDeployed: true,
        needsRedeployment: true,
        deployedAt: '2026-08-01T00:00:00.000Z',
        warnings: [],
        activeDeployment,
        latestDeploymentAttempt,
      },
    })
    expect(mocks.resolveWorkflowContext).toHaveBeenCalledBefore(mocks.getWorkflowDeploymentSummary)
  })

  it('carries the failed attempt error payload when nothing is live', async () => {
    mocks.getWorkflowDeploymentSummary.mockResolvedValue({
      activeDeployment: null,
      latestDeploymentAttempt: {
        ...latestDeploymentAttempt,
        status: 'failed' as const,
        activatedAt: null,
        error: {
          code: 'webhook_conflict',
          message: 'Webhook path already in use',
          retryable: false,
        },
      },
      warnings: ['Deployment attempt failed'],
    })

    const response = await get()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.isDeployed).toBe(false)
    expect(body.data.needsRedeployment).toBe(false)
    expect(body.data.deployedAt).toBeNull()
    expect(body.data.warnings).toEqual(['Deployment attempt failed'])
    expect(body.data.latestDeploymentAttempt.error).toEqual({
      code: 'webhook_conflict',
      message: 'Webhook path already in use',
      retryable: false,
    })
    expect(mocks.checkNeedsRedeployment).not.toHaveBeenCalled()
  })

  it('never reports a deploy time from the stale workflow column once nothing is live', async () => {
    mocks.getWorkflowDeploymentSummary.mockResolvedValue({
      activeDeployment: null,
      latestDeploymentAttempt: null,
      warnings: undefined,
    })

    const response = await get()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.deployedAt).toBeNull()
  })

  it('conceals a workflow the caller cannot reach as 404', async () => {
    mocks.resolvePermission.mockResolvedValue(null)

    const response = await get()

    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('NOT_FOUND')
    expect(mocks.getWorkflowDeploymentSummary).not.toHaveBeenCalled()
  })
})
