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
import { realtimeNotifyMock, realtimeNotifyMockFns } from '@sim/testing/mocks/realtime-notify.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import {
  workflowContextMock,
  workflowContextMockFns,
} from '@sim/testing/mocks/workflow-context.mock'
import {
  workflowsOrchestrationMock,
  workflowsOrchestrationMockFns,
} from '@sim/testing/mocks/workflows-orchestration.mock'
import { workflowsPersistenceUtilsMock } from '@sim/testing/mocks/workflows-persistence-utils.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/audit', () => auditMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/workflows/application/context', () => workflowContextMock)
vi.mock('@/lib/workflows/orchestration', () => workflowsOrchestrationMock)
vi.mock('@/lib/workflows/persistence/utils', () => workflowsPersistenceUtilsMock)
vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

import { POST } from '@/app/api/v2/workflows/[workflowId]/versions/[version]/revert/route'

const { mockPerformRevertToVersion } = workflowsOrchestrationMockFns

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

async function post(version = '3') {
  const request = createMockRequest({
    method: 'POST',
    url: `http://localhost/api/v2/workflows/workflow-1/versions/${version}/revert`,
  })
  return POST(request, createRouteContext({ workflowId: 'workflow-1', version }))
}

describe('POST /api/v2/workflows/[workflowId]/versions/[version]/revert', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(personalKeyAuth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('admin')
    workflowContextMockFns.mockResolveActiveWorkflowApplicationContext.mockResolvedValue(
      workflowContext
    )
    mockPerformRevertToVersion.mockResolvedValue({ success: true, lastSaved: 1765535400000 })
  })

  it('overwrites the draft with the version named by the path', async () => {
    const response = await post()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: { id: 'workflow-1', version: 3, lastSaved: 1765535400000 },
    })
    expect(
      workflowContextMockFns.mockResolveActiveWorkflowApplicationContext
    ).toHaveBeenCalledBefore(mockPerformRevertToVersion)
    expect(mockPerformRevertToVersion).toHaveBeenCalledWith(expect.objectContaining({ version: 3 }))
  })

  it('accepts the literal active as a version', async () => {
    const response = await post('active')

    expect(response.status).toBe(200)
    expect((await response.json()).data.version).toBe('active')
    expect(mockPerformRevertToVersion).toHaveBeenCalledWith(
      expect.objectContaining({ version: 'active' })
    )
  })

  it('records one semantic audit entry and notifies collaborators', async () => {
    await post()

    expect(auditMockFns.mockRecordAudit).toHaveBeenCalledTimes(1)
    expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'workflow.deployment_reverted',
        resourceId: 'workflow-1',
      })
    )
    expect(realtimeNotifyMockFns.mockNotifyWorkflowReverted).toHaveBeenCalledWith(
      'workflow-1',
      1765535400000
    )
  })

  it('rejects a workspace API key before canonical loading', async () => {
    v2RouteMocks.authenticate.mockResolvedValue(workspaceKeyAuth)

    const response = await post()

    expect(response.status).toBe(403)
    expect(
      workflowContextMockFns.mockResolveActiveWorkflowApplicationContext
    ).not.toHaveBeenCalled()
    expect(mockPerformRevertToVersion).not.toHaveBeenCalled()
  })

  it('refuses a caller below workspace admin with 403', async () => {
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('write')

    const response = await post()

    expect(response.status).toBe(403)
    expect((await response.json()).error.details.code).toBe('INSUFFICIENT_WORKSPACE_ROLE')
    expect(mockPerformRevertToVersion).not.toHaveBeenCalled()
  })

  it('conceals a workflow the caller cannot reach as 404', async () => {
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue(null)

    const response = await post()

    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('NOT_FOUND')
    expect(mockPerformRevertToVersion).not.toHaveBeenCalled()
  })

  it('writes no audit entry and sends no notification when the revert fails', async () => {
    mockPerformRevertToVersion.mockResolvedValue({
      success: false,
      errorCode: 'not_found',
      error: 'Deployment version not found',
    })

    const response = await post()

    expect(response.status).toBe(404)
    expect((await response.json()).error.message).toBe('Deployment version not found')
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
    expect(realtimeNotifyMockFns.mockNotifyWorkflowReverted).not.toHaveBeenCalled()
  })
})
