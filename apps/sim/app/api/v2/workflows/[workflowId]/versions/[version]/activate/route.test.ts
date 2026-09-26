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
import {
  workflowContextMock,
  workflowContextMockFns,
} from '@sim/testing/mocks/workflow-context.mock'
import {
  workflowsOrchestrationMock,
  workflowsOrchestrationMockFns,
} from '@sim/testing/mocks/workflows-orchestration.mock'
import {
  workflowsPersistenceUtilsMock,
  workflowsPersistenceUtilsMockFns,
} from '@sim/testing/mocks/workflows-persistence-utils.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  assertMutable: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/workflows/application/context', () => workflowContextMock)
vi.mock('@/lib/workflows/orchestration', () => workflowsOrchestrationMock)
vi.mock('@/lib/workflows/persistence/utils', () => workflowsPersistenceUtilsMock)
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

import { POST } from '@/app/api/v2/workflows/[workflowId]/versions/[version]/activate/route'

const { mockPerformActivateVersion } = workflowsOrchestrationMockFns

const personalKeyAuth = {
  principal: createPersonalApiKeyPrincipal({ keyId: 'personal-key-1' }),
  rateLimitSubjectIds: ['api-key:personal-key-1', 'user:user-1'] as const,
  rateLimitSubscription: null,
  keyType: 'personal' as const,
}

const workspaceKeyAuth = {
  principal: createWorkspaceApiKeyPrincipal({ keyId: 'workspace-key-1' }),
  rateLimitSubjectIds: ['api-key:workspace-key-1'] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}

const workflowContext = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
  workflowId: 'workflow-1',
  workflow: { id: 'workflow-1', name: 'Release workflow', workspaceId: 'workspace-1' },
}

async function post(version = '3', body?: unknown) {
  const request = new NextRequest(
    `http://localhost/api/v2/workflows/workflow-1/versions/${version}/activate`,
    body === undefined
      ? { method: 'POST' }
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }
  )
  return POST(request, createRouteContext({ workflowId: 'workflow-1', version }))
}

describe('POST /api/v2/workflows/[workflowId]/versions/[version]/activate', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(personalKeyAuth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('admin')
    workflowContextMockFns.mockResolveActiveWorkflowApplicationContext.mockResolvedValue(
      workflowContext
    )
    mocks.assertMutable.mockResolvedValue(undefined)
    mockPerformActivateVersion.mockResolvedValue({
      success: true,
      deployedAt: new Date('2026-08-01T00:00:00.000Z'),
      activeDeployment: null,
      latestDeploymentAttempt: null,
      warnings: [],
    })
  })

  it('promotes the version named by the path with an empty body', async () => {
    const response = await post()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        id: 'workflow-1',
        isDeployed: false,
        deployedAt: '2026-08-01T00:00:00.000Z',
        version: 3,
        warnings: [],
        activeDeployment: null,
        latestDeploymentAttempt: null,
      },
    })
    expect(
      workflowContextMockFns.mockResolveActiveWorkflowApplicationContext
    ).toHaveBeenCalledBefore(mockPerformActivateVersion)
    expect(mockPerformActivateVersion).toHaveBeenCalledWith(expect.objectContaining({ version: 3 }))
  })

  /**
   * Activation is unconditional on the current state, unlike rollback, which
   * refuses when nothing is deployed. Nothing may consult the previous version.
   */
  it('never falls back to the previous version', async () => {
    await post()

    expect(
      workflowsPersistenceUtilsMockFns.mockFindPreviousDeploymentVersion
    ).not.toHaveBeenCalled()
  })

  it('rejects the rollback body rather than activating a different version', async () => {
    const response = await post('3', { version: 2 })

    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('BAD_REQUEST')
    expect(mockPerformActivateVersion).not.toHaveBeenCalled()
  })

  it('rejects a workspace API key before canonical loading', async () => {
    v2RouteMocks.authenticate.mockResolvedValue(workspaceKeyAuth)

    const response = await post()

    expect(response.status).toBe(403)
    expect(
      workflowContextMockFns.mockResolveActiveWorkflowApplicationContext
    ).not.toHaveBeenCalled()
    expect(mockPerformActivateVersion).not.toHaveBeenCalled()
  })

  it('refuses a caller below workspace admin with 403', async () => {
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('write')

    const response = await post()

    expect(response.status).toBe(403)
    expect((await response.json()).error.details.code).toBe('INSUFFICIENT_WORKSPACE_ROLE')
    expect(mockPerformActivateVersion).not.toHaveBeenCalled()
  })

  it('conceals a workflow the caller cannot reach as 404', async () => {
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue(null)

    const response = await post()

    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('NOT_FOUND')
    expect(mockPerformActivateVersion).not.toHaveBeenCalled()
  })

  it('maps a competing lifecycle attempt to 409', async () => {
    mockPerformActivateVersion.mockResolvedValue({
      success: false,
      errorCode: 'conflict',
      error: 'A deployment is already in progress',
    })

    const response = await post()

    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.error.code).toBe('CONFLICT')
    expect(body.error.message).toBe('A deployment is already in progress')
  })
})
