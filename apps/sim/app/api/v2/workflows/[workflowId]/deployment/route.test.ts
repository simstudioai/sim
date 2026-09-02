/**
 * @vitest-environment node
 */
import {
  MockV2ApiKeyUnauthenticatedError,
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { MockPublicApiNotAllowedError, mocks } = vi.hoisted(() => {
  class MockPublicApiNotAllowedError extends Error {}
  return {
    MockPublicApiNotAllowedError,
    mocks: {
      resolvePermission: vi.fn(),
      resolveWorkflowContext: vi.fn(),
      getWorkflowDeploymentSummary: vi.fn(),
      listWebhookUrls: vi.fn(),
      checkNeedsRedeployment: vi.fn(),
      validatePublicApiAllowed: vi.fn(),
      updatePublicApiRow: vi.fn(),
      audit: vi.fn(),
      notifyUpdated: vi.fn(),
    },
  }
})

vi.mock('@sim/audit', () => ({
  AuditAction: { WORKFLOW_PUBLIC_API_TOGGLED: 'workflow.public_api_toggled' },
  AuditResourceType: { WORKFLOW: 'workflow' },
  recordAudit: mocks.audit,
}))
vi.mock('@sim/db', () => ({
  db: {
    update: () => ({
      set: () => ({ where: () => ({ returning: () => mocks.updatePublicApiRow() }) }),
    }),
  },
  workflow: {},
}))
vi.mock('@/ee/access-control/utils/permission-check', () => ({
  PublicApiNotAllowedError: MockPublicApiNotAllowedError,
  validatePublicApiAllowed: mocks.validatePublicApiAllowed,
}))
vi.mock('@/lib/realtime/notify', () => ({ notifyWorkflowUpdated: mocks.notifyUpdated }))

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
vi.mock('@/lib/webhooks/deployed-urls', () => ({
  listDeployedWebhookUrls: mocks.listWebhookUrls,
}))
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

import { GET, PATCH } from '@/app/api/v2/workflows/[workflowId]/deployment/route'

const auth = {
  principal: {
    kind: 'personal_api_key' as const,
    userId: 'user-1',
    keyId: 'personal-key-1',
  },
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
    isPublicApi: false,
  },
}

async function get() {
  const request = new NextRequest('http://localhost/api/v2/workflows/workflow-1/deployment')
  return GET(request, { params: Promise.resolve({ workflowId: 'workflow-1' }) })
}

describe('GET /api/v2/workflows/[workflowId]/deployment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.resolveWorkflowContext.mockResolvedValue(workflowContext)
    mocks.getWorkflowDeploymentSummary.mockResolvedValue({
      activeDeployment,
      latestDeploymentAttempt,
      warnings: undefined,
    })
    mocks.checkNeedsRedeployment.mockResolvedValue(true)
    mocks.listWebhookUrls.mockResolvedValue([])
  })

  it('publishes draft-versus-live drift and the latest attempt after canonical authorization', async () => {
    const response = await get()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        id: 'workflow-1',
        isDeployed: true,
        needsRedeployment: true,
        isPublicApi: false,
        deployedAt: '2026-08-01T00:00:00.000Z',
        warnings: [],
        activeDeployment,
        latestDeploymentAttempt,
        webhooks: [],
      },
    })
    expect(mocks.resolveWorkflowContext).toHaveBeenCalledBefore(mocks.getWorkflowDeploymentSummary)
  })

  /**
   * `webhookUrlDisplay` reads back as `null` after a successful deploy, so the
   * deployment read is where a caller learns the URL the deploy started
   * serving. Only a live deployment has one; nothing is read while undeployed.
   */
  it('publishes the resolved delivery URL of every live webhook', async () => {
    mocks.listWebhookUrls.mockResolvedValue([
      {
        blockId: 'block-1',
        provider: 'generic',
        url: 'https://sim.test/api/webhooks/trigger/leads',
      },
    ])

    const response = await get()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.webhooks).toEqual([
      {
        blockId: 'block-1',
        provider: 'generic',
        url: 'https://sim.test/api/webhooks/trigger/leads',
      },
    ])
    expect(mocks.listWebhookUrls).toHaveBeenCalledWith('workflow-1')
  })

  it('publishes no webhook URLs, and reads none, while nothing is live', async () => {
    mocks.getWorkflowDeploymentSummary.mockResolvedValue({
      activeDeployment: null,
      latestDeploymentAttempt: null,
      warnings: [],
    })

    const body = await (await get()).json()

    expect(body.data.webhooks).toEqual([])
    expect(mocks.listWebhookUrls).not.toHaveBeenCalled()
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

  /**
   * `isPublicApi` removes authentication from a deployed workflow and was
   * settable through `PATCH` on this path while appearing in no read, so a
   * caller had no way to audit whether it was on. It must track the column in
   * both directions, not be pinned to a constant.
   */
  it('publishes the public-API flag in both states', async () => {
    const offBody = await (await get()).json()
    expect(offBody.data.isPublicApi).toBe(false)

    mocks.resolveWorkflowContext.mockResolvedValue({
      ...workflowContext,
      workflow: { ...workflowContext.workflow, isPublicApi: true },
    })

    const onBody = await (await get()).json()
    expect(onBody.data.isPublicApi).toBe(true)
  })

  it('conceals a workflow the caller cannot reach as 404', async () => {
    mocks.resolvePermission.mockResolvedValue(null)

    const response = await get()

    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('NOT_FOUND')
    expect(mocks.getWorkflowDeploymentSummary).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated request', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await get()

    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('UNAUTHORIZED')
  })
})

const workspaceKeyAuth = {
  principal: {
    kind: 'workspace_api_key' as const,
    workspaceId: 'workspace-1',
    keyId: 'workspace-key-1',
  },
  rateLimitSubjectIds: ['api-key:workspace-key-1'] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}

async function patch(body: unknown) {
  const request = new NextRequest('http://localhost/api/v2/workflows/workflow-1/deployment', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return PATCH(request, { params: Promise.resolve({ workflowId: 'workflow-1' }) })
}

describe('PATCH /api/v2/workflows/[workflowId]/deployment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.resolveWorkflowContext.mockResolvedValue(workflowContext)
    mocks.validatePublicApiAllowed.mockResolvedValue(undefined)
    mocks.updatePublicApiRow.mockResolvedValue([{ id: 'workflow-1' }])
  })

  /**
   * The widening this route depends on: the operation used to accept sessions
   * only, which made a personal key — the same accountable human — a 403.
   */
  it('accepts a personal API key and checks the sharing policy for the acting human', async () => {
    const response = await patch({ isPublicApi: true })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { id: 'workflow-1', isPublicApi: true } })
    expect(mocks.validatePublicApiAllowed).toHaveBeenCalledWith('user-1', 'workspace-1')
    expect(mocks.audit).toHaveBeenCalledTimes(1)
    expect(mocks.notifyUpdated).toHaveBeenCalledWith('workflow-1')
  })

  it('does not consult the sharing policy when disabling public access', async () => {
    const response = await patch({ isPublicApi: false })

    expect(response.status).toBe(200)
    expect((await response.json()).data.isPublicApi).toBe(false)
    expect(mocks.validatePublicApiAllowed).not.toHaveBeenCalled()
  })

  it('names the sharing refusal with an actionable forbidden code', async () => {
    mocks.validatePublicApiAllowed.mockRejectedValue(
      new MockPublicApiNotAllowedError('not allowed')
    )

    const response = await patch({ isPublicApi: true })

    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.error.details.code).toBe('PUBLIC_SHARING_NOT_ALLOWED')
    expect(body.error.message).toBe('Public API access is disabled')
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('rejects a workspace API key before canonical loading', async () => {
    v2RouteMocks.authenticate.mockResolvedValue(workspaceKeyAuth)

    const response = await patch({ isPublicApi: true })

    expect(response.status).toBe(403)
    expect(mocks.resolveWorkflowContext).not.toHaveBeenCalled()
  })

  it('refuses a caller below workspace admin with 403', async () => {
    mocks.resolvePermission.mockResolvedValue('write')

    const response = await patch({ isPublicApi: true })

    expect(response.status).toBe(403)
    expect((await response.json()).error.details.code).toBe('INSUFFICIENT_WORKSPACE_ROLE')
    expect(mocks.updatePublicApiRow).not.toHaveBeenCalled()
  })

  it('conceals a workflow the caller cannot reach as 404', async () => {
    mocks.resolvePermission.mockResolvedValue(null)

    const response = await patch({ isPublicApi: true })

    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('NOT_FOUND')
    expect(mocks.updatePublicApiRow).not.toHaveBeenCalled()
  })

  it('rejects a body that names no setting', async () => {
    const response = await patch({})

    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('BAD_REQUEST')
    expect(mocks.updatePublicApiRow).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated request', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await patch({ isPublicApi: true })

    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('UNAUTHORIZED')
  })
})
