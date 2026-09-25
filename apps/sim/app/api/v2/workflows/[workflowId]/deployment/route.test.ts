import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import {
  createPersonalApiKeyPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { createRouteContext } from '@sim/testing/helpers/http'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { dbChainMockFns } from '@sim/testing/mocks/database.mock'
import {
  MockPublicApiNotAllowedError,
  permissionCheckMock,
  permissionCheckMockFns,
} from '@sim/testing/mocks/permission-check.mock'
import { realtimeNotifyMock, realtimeNotifyMockFns } from '@sim/testing/mocks/realtime-notify.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import {
  workflowContextMock,
  workflowContextMockFns,
} from '@sim/testing/mocks/workflow-context.mock'
import {
  workflowDeploymentStatusMock,
  workflowDeploymentStatusMockFns,
} from '@sim/testing/mocks/workflow-deployment-status.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks } = vi.hoisted(() => {
  return {
    mocks: {
      getWorkflowDeploymentSummary: vi.fn(),
      listWebhookUrls: vi.fn(),
    },
  }
})

vi.mock('@sim/audit', () => auditMock)
vi.mock('@/ee/access-control/utils/permission-check', () => permissionCheckMock)
vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/workflows/application/context', () => workflowContextMock)
vi.mock('@/lib/workflows/orchestration/deploy', () => ({
  getWorkflowDeploymentSummary: mocks.getWorkflowDeploymentSummary,
  performActivateVersion: vi.fn(),
  performFullDeploy: vi.fn(),
  performFullUndeploy: vi.fn(),
  performRevertToVersion: vi.fn(),
}))
vi.mock('@/lib/workflows/deployment-status', () => workflowDeploymentStatusMock)
vi.mock('@/lib/webhooks/deployed-urls', () => ({
  listDeployedWebhookUrls: mocks.listWebhookUrls,
}))
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

import { GET, PATCH } from '@/app/api/v2/workflows/[workflowId]/deployment/route'

const { mockCheckNeedsRedeployment } = workflowDeploymentStatusMockFns

const auth = {
  principal: createPersonalApiKeyPrincipal({ keyId: 'personal-key-1' }),
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
  const request = createMockRequest({
    url: 'http://localhost/api/v2/workflows/workflow-1/deployment',
  })
  return GET(request, createRouteContext({ workflowId: 'workflow-1' }))
}

describe('GET /api/v2/workflows/[workflowId]/deployment', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('read')
    workflowContextMockFns.mockResolveActiveWorkflowApplicationContext.mockResolvedValue(
      workflowContext
    )
    mocks.getWorkflowDeploymentSummary.mockResolvedValue({
      activeDeployment,
      latestDeploymentAttempt,
      warnings: undefined,
    })
    mockCheckNeedsRedeployment.mockResolvedValue(true)
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
    expect(
      workflowContextMockFns.mockResolveActiveWorkflowApplicationContext
    ).toHaveBeenCalledBefore(mocks.getWorkflowDeploymentSummary)
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
    expect(mockCheckNeedsRedeployment).not.toHaveBeenCalled()
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

    workflowContextMockFns.mockResolveActiveWorkflowApplicationContext.mockResolvedValue({
      ...workflowContext,
      workflow: { ...workflowContext.workflow, isPublicApi: true },
    })

    const onBody = await (await get()).json()
    expect(onBody.data.isPublicApi).toBe(true)
  })

  it('conceals a workflow the caller cannot reach as 404', async () => {
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue(null)

    const response = await get()

    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('NOT_FOUND')
    expect(mocks.getWorkflowDeploymentSummary).not.toHaveBeenCalled()
  })
})

const workspaceKeyAuth = {
  principal: createWorkspaceApiKeyPrincipal({ keyId: 'workspace-key-1' }),
  rateLimitSubjectIds: ['api-key:workspace-key-1'] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}

async function patch(body: unknown) {
  const request = createMockRequest({
    method: 'PATCH',
    url: 'http://localhost/api/v2/workflows/workflow-1/deployment',
    body,
  })
  return PATCH(request, createRouteContext({ workflowId: 'workflow-1' }))
}

describe('PATCH /api/v2/workflows/[workflowId]/deployment', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('admin')
    workflowContextMockFns.mockResolveActiveWorkflowApplicationContext.mockResolvedValue(
      workflowContext
    )
    permissionCheckMockFns.mockValidatePublicApiAllowed.mockResolvedValue(undefined)
    dbChainMockFns.returning.mockResolvedValue([{ id: 'workflow-1' }])
  })

  /**
   * The widening this route depends on: the operation used to accept sessions
   * only, which made a personal key — the same accountable human — a 403.
   */
  it('accepts a personal API key and checks the sharing policy for the acting human', async () => {
    const response = await patch({ isPublicApi: true })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { id: 'workflow-1', isPublicApi: true } })
    expect(permissionCheckMockFns.mockValidatePublicApiAllowed).toHaveBeenCalledWith(
      'user-1',
      'workspace-1'
    )
    expect(auditMockFns.mockRecordAudit).toHaveBeenCalledTimes(1)
    expect(realtimeNotifyMockFns.mockNotifyWorkflowUpdated).toHaveBeenCalledWith('workflow-1')
  })

  it('does not consult the sharing policy when disabling public access', async () => {
    const response = await patch({ isPublicApi: false })

    expect(response.status).toBe(200)
    expect((await response.json()).data.isPublicApi).toBe(false)
    expect(permissionCheckMockFns.mockValidatePublicApiAllowed).not.toHaveBeenCalled()
  })

  it('names the sharing refusal with an actionable forbidden code', async () => {
    permissionCheckMockFns.mockValidatePublicApiAllowed.mockRejectedValue(
      new MockPublicApiNotAllowedError()
    )

    const response = await patch({ isPublicApi: true })

    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.error.details.code).toBe('PUBLIC_SHARING_NOT_ALLOWED')
    expect(body.error.message).toBe('Public API access is disabled')
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
  })

  it('rejects a workspace API key before canonical loading', async () => {
    v2RouteMocks.authenticate.mockResolvedValue(workspaceKeyAuth)

    const response = await patch({ isPublicApi: true })

    expect(response.status).toBe(403)
    expect(
      workflowContextMockFns.mockResolveActiveWorkflowApplicationContext
    ).not.toHaveBeenCalled()
  })

  it('refuses a caller below workspace admin with 403', async () => {
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('write')

    const response = await patch({ isPublicApi: true })

    expect(response.status).toBe(403)
    expect((await response.json()).error.details.code).toBe('INSUFFICIENT_WORKSPACE_ROLE')
    expect(dbChainMockFns.returning).not.toHaveBeenCalled()
  })

  it('conceals a workflow the caller cannot reach as 404', async () => {
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue(null)

    const response = await patch({ isPublicApi: true })

    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('NOT_FOUND')
    expect(dbChainMockFns.returning).not.toHaveBeenCalled()
  })
})
