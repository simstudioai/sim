import type { Principal } from '@sim/auth/principal'
import { WorkflowLockedError } from '@sim/platform-authz/workflow'
import {
  createPersonalApiKeyPrincipal,
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { realtimeNotifyMock } from '@sim/testing/mocks/realtime-notify.mock'
import { workflowAuthzMockFns } from '@sim/testing/mocks/workflow-authz.mock'
import {
  workflowContextMock,
  workflowContextMockFns,
} from '@sim/testing/mocks/workflow-context.mock'
import { workflowDeploymentStatusMock } from '@sim/testing/mocks/workflow-deployment-status.mock'
import {
  workflowsOrchestrationMock,
  workflowsOrchestrationMockFns,
} from '@sim/testing/mocks/workflows-orchestration.mock'
import {
  workflowsPersistenceUtilsMock,
  workflowsPersistenceUtilsMockFns,
} from '@sim/testing/mocks/workflows-persistence-utils.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listMcpTools: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/workflows/application/context', () => workflowContextMock)

vi.mock('@/lib/workflows/orchestration', () => workflowsOrchestrationMock)

vi.mock('@/lib/workflows/persistence/utils', () => workflowsPersistenceUtilsMock)

vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)

vi.mock('@/lib/mcp/queries', () => ({
  listLiveWorkflowMcpToolsForWorkflow: mocks.listMcpTools,
}))

vi.mock('@/lib/workflows/deployment-status', () => workflowDeploymentStatusMock)

import {
  activateWorkflowVersion,
  deployWorkflow,
  undeployWorkflow,
} from '@/lib/workflows/application/deployments'

const mockAssertMutable = workflowAuthzMockFns.mockAssertWorkflowMutable
const mockActivate = workflowsOrchestrationMockFns.mockPerformActivateVersion
const mockDeploy = workflowsOrchestrationMockFns.mockPerformFullDeploy
const mockUndeploy = workflowsOrchestrationMockFns.mockPerformFullUndeploy
const mockRevert = workflowsOrchestrationMockFns.mockPerformRevertToVersion

const mockAudit = auditMockFns.mockRecordAudit
const mockResolvePermission = workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission
const mockResolveContext = workflowContextMockFns.mockResolveActiveWorkflowApplicationContext

const workflow = {
  id: 'workflow-1',
  name: 'Release workflow',
  userId: 'owner-1',
  workspaceId: 'workspace-1',
  isDeployed: true,
}
const context = {
  workflowId: 'workflow-1',
  workflow,
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}

const adminPrincipals: Array<{ principal: Principal; actorUserId: string }> = [
  {
    principal: createSessionPrincipal({ userId: 'session-user' }),
    actorUserId: 'session-user',
  },
  {
    principal: createPersonalApiKeyPrincipal({ userId: 'key-user', keyId: 'personal-key' }),
    actorUserId: 'key-user',
  },
  {
    principal: {
      kind: 'delegated',
      serviceId: 'copilot',
      subjectUserId: 'delegated-user',
      workspaceId: 'workspace-1',
      delegationId: 'delegation-1',
      audience: 'sim:workflows',
      issuedAt: new Date('2026-01-01T00:00:00Z'),
      expiresAt: new Date('2999-01-01T00:00:00Z'),
    },
    actorUserId: 'delegated-user',
  },
]

describe('workflow deployment application use cases', () => {
  beforeEach(() => {
    mockResolveContext.mockResolvedValue(context)
    mockResolvePermission.mockResolvedValue('admin')
    mockDeploy.mockResolvedValue({
      success: true,
      deployedAt: new Date('2026-08-08T00:00:00Z'),
      version: 4,
      activeDeployment: null,
      latestDeploymentAttempt: null,
      warnings: [],
    })
    mockUndeploy.mockResolvedValue({ success: true, warnings: [] })
    mocks.listMcpTools.mockResolvedValue([])
    mockActivate.mockResolvedValue({
      success: true,
      deployedAt: new Date('2026-08-08T00:01:00Z'),
      activeDeployment: null,
      latestDeploymentAttempt: null,
      warnings: [],
    })
    workflowsPersistenceUtilsMockFns.mockFindPreviousDeploymentVersion.mockResolvedValue({
      ok: true,
      version: 3,
    })
    mockRevert.mockResolvedValue({ success: true, lastSaved: 12345 })
  })

  it.each(adminPrincipals)(
    'admits $principal.kind deploys with canonical actor attribution',
    async ({ principal, actorUserId }) => {
      await deployWorkflow.execute({
        principal,
        input: {
          workflowId: 'workflow-1',
          name: 'Version 4',
          description: 'Production release',
          requestId: 'request-1',
          idempotencyKey: 'deploy-idempotency-1',
        },
      })

      expect(mockDeploy).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowId: 'workflow-1',
          userId: actorUserId,
          actorId: actorUserId,
          ...(principal.kind === 'delegated' ? { captureAnalytics: false } : {}),
          versionName: 'Version 4',
          versionDescription: 'Production release',
          requestId: 'request-1',
          idempotencyKey: 'deploy-idempotency-1',
        })
      )
      expect(mockAudit).not.toHaveBeenCalled()
    }
  )

  it('denies workspace API keys before canonical lookup for admin transitions', async () => {
    await expect(
      deployWorkflow.execute({
        principal: createWorkspaceApiKeyPrincipal({ keyId: 'workspace-key' }),
        input: { workflowId: 'workflow-1', requestId: 'request-1' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mockResolveContext).not.toHaveBeenCalled()
    expect(mockDeploy).not.toHaveBeenCalled()
  })

  it('admits executor deployment transitions through canonical workflow authorization', async () => {
    await deployWorkflow.execute({
      principal: {
        kind: 'delegated',
        serviceId: 'executor',
        subjectUserId: 'user-1',
        workspaceId: 'workspace-1',
        delegationId: 'executor-1',
        audience: 'sim:workflows',
        issuedAt: new Date('2026-08-08T00:00:00Z'),
        expiresAt: new Date('2999-08-08T00:00:00Z'),
        delegationContext: {
          kind: 'workflow_execution',
          workflowId: 'origin-workflow',
          executionId: 'execution-1',
        },
      },
      input: { workflowId: 'workflow-1', requestId: 'request-1' },
    })

    expect(mockResolveContext).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      assertedWorkspaceId: undefined,
    })
    expect(mockResolvePermission).toHaveBeenCalledWith('user-1', 'workspace-1', null, undefined, {
      forUpdate: undefined,
    })
    expect(mockAssertMutable).toHaveBeenCalledWith('workflow-1')
    expect(mockDeploy).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'workflow-1',
        userId: 'user-1',
        actorId: 'user-1',
        actor: {
          kind: 'delegated',
          serviceId: 'executor',
          subjectUserId: 'user-1',
          delegationId: 'executor-1',
        },
        captureAnalytics: false,
        requestId: 'request-1',
      })
    )
  })

  it('requires current admin permission before deployment', async () => {
    mockResolvePermission.mockResolvedValueOnce('write')

    await expect(
      deployWorkflow.execute({
        principal: createSessionPrincipal(),
        input: { workflowId: 'workflow-1', requestId: 'request-1' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mockAssertMutable).not.toHaveBeenCalled()
    expect(mockDeploy).not.toHaveBeenCalled()
  })

  it('rejects undeploy and rollback when the canonical workflow is not deployed', async () => {
    mockResolveContext.mockResolvedValue({
      ...context,
      workflow: { ...workflow, isDeployed: false },
    })
    const principal = createSessionPrincipal()

    await expect(
      undeployWorkflow.execute({
        principal,
        input: { workflowId: 'workflow-1', requestId: 'request-5' },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    await expect(
      activateWorkflowVersion.execute({
        principal,
        input: {
          workflowId: 'workflow-1',
          version: 1,
          transition: 'rollback',
          requestId: 'request-6',
        },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mockUndeploy).not.toHaveBeenCalled()
    expect(mockActivate).not.toHaveBeenCalled()
  })

  it('maps lock failures and propagates manager infrastructure failures', async () => {
    mockAssertMutable.mockRejectedValueOnce(new WorkflowLockedError('Workflow is locked'))

    await expect(
      deployWorkflow.execute({
        principal: createSessionPrincipal(),
        input: { workflowId: 'workflow-1', requestId: 'request-7' },
      })
    ).rejects.toMatchObject({ code: 'locked', message: 'Workflow is locked' })

    const infrastructureError = new Error('deployment manager unavailable')
    mockActivate.mockRejectedValueOnce(infrastructureError)
    await expect(
      activateWorkflowVersion.execute({
        principal: createSessionPrincipal(),
        input: {
          workflowId: 'workflow-1',
          version: 1,
          transition: 'activate',
          requestId: 'request-8',
        },
      })
    ).rejects.toBe(infrastructureError)
  })

  it('does not expose an internal deployment failure message', async () => {
    mockDeploy.mockResolvedValueOnce({
      success: false,
      errorCode: 'internal',
      error: 'driver connection string',
    })

    await expect(
      deployWorkflow.execute({
        principal: createSessionPrincipal(),
        input: { workflowId: 'workflow-1', requestId: 'request-9' },
      })
    ).rejects.toThrow('Failed to deploy workflow')
  })
})
