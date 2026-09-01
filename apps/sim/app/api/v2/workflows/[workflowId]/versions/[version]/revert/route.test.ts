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

const mocks = vi.hoisted(() => ({
  resolvePermission: vi.fn(),
  resolveWorkflowContext: vi.fn(),
  revert: vi.fn(),
  audit: vi.fn(),
  notifyReverted: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { WORKFLOW_DEPLOYMENT_REVERTED: 'workflow.deployment_reverted' },
  AuditResourceType: { WORKFLOW: 'workflow' },
  recordAudit: mocks.audit,
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
vi.mock('@/lib/workflows/orchestration', () => ({
  getWorkflowDeploymentSummary: vi.fn(),
  performActivateVersion: vi.fn(),
  performFullDeploy: vi.fn(),
  performFullUndeploy: vi.fn(),
  performRevertToVersion: mocks.revert,
}))
vi.mock('@/lib/workflows/persistence/utils', () => ({
  findPreviousDeploymentVersion: vi.fn(),
  updateDeploymentVersionMetadata: vi.fn(),
}))
vi.mock('@/lib/realtime/notify', () => ({ notifyWorkflowReverted: mocks.notifyReverted }))
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

import { POST } from '@/app/api/v2/workflows/[workflowId]/versions/[version]/revert/route'

const personalKeyAuth = {
  principal: { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'personal-key-1' },
  rateLimitSubjectIds: ['api-key:personal-key-1', 'user:user-1'] as const,
  rateLimitSubscription: null,
  keyType: 'personal' as const,
}

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

const workflowContext = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
  workflowId: 'workflow-1',
  workflow: { id: 'workflow-1', name: 'Release workflow', workspaceId: 'workspace-1' },
}

async function post(version = '3') {
  const request = new NextRequest(
    `http://localhost/api/v2/workflows/workflow-1/versions/${version}/revert`,
    { method: 'POST' }
  )
  return POST(request, { params: Promise.resolve({ workflowId: 'workflow-1', version }) })
}

describe('POST /api/v2/workflows/[workflowId]/versions/[version]/revert', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(personalKeyAuth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.resolveWorkflowContext.mockResolvedValue(workflowContext)
    mocks.revert.mockResolvedValue({ success: true, lastSaved: 1765535400000 })
  })

  it('overwrites the draft with the version named by the path', async () => {
    const response = await post()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: { id: 'workflow-1', version: 3, lastSaved: 1765535400000 },
    })
    expect(mocks.resolveWorkflowContext).toHaveBeenCalledBefore(mocks.revert)
    expect(mocks.revert).toHaveBeenCalledWith(expect.objectContaining({ version: 3 }))
  })

  it('accepts the literal active as a version', async () => {
    const response = await post('active')

    expect(response.status).toBe(200)
    expect((await response.json()).data.version).toBe('active')
    expect(mocks.revert).toHaveBeenCalledWith(expect.objectContaining({ version: 'active' }))
  })

  it.each(['0', '-1', '1.5', 'latest'])(
    'rejects %s as a version before any canonical load',
    async (version) => {
      const response = await post(version)

      expect(response.status).toBe(400)
      expect((await response.json()).error.code).toBe('BAD_REQUEST')
      expect(mocks.resolveWorkflowContext).not.toHaveBeenCalled()
    }
  )

  it('records one semantic audit entry and notifies collaborators', async () => {
    await post()

    expect(mocks.audit).toHaveBeenCalledTimes(1)
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'workflow.deployment_reverted',
        resourceId: 'workflow-1',
      })
    )
    expect(mocks.notifyReverted).toHaveBeenCalledWith('workflow-1', 1765535400000)
  })

  it('rejects a workspace API key before canonical loading', async () => {
    v2RouteMocks.authenticate.mockResolvedValue(workspaceKeyAuth)

    const response = await post()

    expect(response.status).toBe(403)
    expect(mocks.resolveWorkflowContext).not.toHaveBeenCalled()
    expect(mocks.revert).not.toHaveBeenCalled()
  })

  it('refuses a caller below workspace admin with 403', async () => {
    mocks.resolvePermission.mockResolvedValue('write')

    const response = await post()

    expect(response.status).toBe(403)
    expect((await response.json()).error.details.code).toBe('INSUFFICIENT_WORKSPACE_ROLE')
    expect(mocks.revert).not.toHaveBeenCalled()
  })

  it('conceals a workflow the caller cannot reach as 404', async () => {
    mocks.resolvePermission.mockResolvedValue(null)

    const response = await post()

    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('NOT_FOUND')
    expect(mocks.revert).not.toHaveBeenCalled()
  })

  it('writes no audit entry and sends no notification when the revert fails', async () => {
    mocks.revert.mockResolvedValue({
      success: false,
      errorCode: 'not_found',
      error: 'Deployment version not found',
    })

    const response = await post()

    expect(response.status).toBe(404)
    expect((await response.json()).error.message).toBe('Deployment version not found')
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.notifyReverted).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated request', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await post()

    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('UNAUTHORIZED')
  })
})
