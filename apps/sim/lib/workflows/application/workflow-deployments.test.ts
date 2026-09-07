/**
 * @vitest-environment node
 */
import type { Principal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestRuntimePrincipal } from '@/lib/auth/runtime-principal.test-support'

const { MockWorkflowLockedError, mocks } = vi.hoisted(() => {
  class MockWorkflowLockedError extends Error {}
  return {
    MockWorkflowLockedError,
    mocks: {
      activate: vi.fn(),
      assertMutable: vi.fn(),
      audit: vi.fn(),
      deploy: vi.fn(),
      findPrevious: vi.fn(),
      notifyReverted: vi.fn(),
      revert: vi.fn(),
      resolveContext: vi.fn(),
      resolvePermission: vi.fn(),
      undeploy: vi.fn(),
    },
  }
})

vi.mock('@sim/audit', () => ({
  AuditAction: {
    WORKFLOW_DEPLOYMENT_REVERTED: 'workflow.deployment_reverted',
    WORKFLOW_UNDEPLOYED: 'workflow.undeployed',
  },
  AuditResourceType: { WORKFLOW: 'workflow' },
  recordAudit: mocks.audit,
}))

vi.mock('@sim/platform-authz/workflow', () => ({
  assertWorkflowMutable: mocks.assertMutable,
  WorkflowLockedError: MockWorkflowLockedError,
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
  resolveActiveWorkflowApplicationContext: mocks.resolveContext,
}))

vi.mock('@/lib/workflows/orchestration', () => ({
  performActivateVersion: mocks.activate,
  performFullDeploy: mocks.deploy,
  performFullUndeploy: mocks.undeploy,
  performRevertToVersion: mocks.revert,
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  findPreviousDeploymentVersion: mocks.findPrevious,
  updateDeploymentVersionMetadata: vi.fn(),
}))

vi.mock('@/lib/realtime/notify', () => ({
  notifyWorkflowReverted: mocks.notifyReverted,
}))

vi.mock('@/lib/workflows/deployment-status', () => ({
  checkNeedsRedeployment: vi.fn(),
}))

import {
  activateWorkflowVersion,
  deployWorkflow,
  revertWorkflowVersion,
  undeployWorkflow,
} from '@/lib/workflows/application/deployments'

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
    principal: { kind: 'session', userId: 'session-user', sessionId: 'session-1' },
    actorUserId: 'session-user',
  },
  {
    principal: { kind: 'personal_api_key', userId: 'key-user', keyId: 'personal-key' },
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
    vi.clearAllMocks()
    mocks.resolveContext.mockResolvedValue(context)
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.deploy.mockResolvedValue({
      success: true,
      deployedAt: new Date('2026-08-08T00:00:00Z'),
      version: 4,
      activeDeployment: null,
      latestDeploymentAttempt: null,
      warnings: [],
    })
    mocks.undeploy.mockResolvedValue({ success: true, warnings: [] })
    mocks.activate.mockResolvedValue({
      success: true,
      deployedAt: new Date('2026-08-08T00:01:00Z'),
      activeDeployment: null,
      latestDeploymentAttempt: null,
      warnings: [],
    })
    mocks.findPrevious.mockResolvedValue({ ok: true, version: 3 })
    mocks.revert.mockResolvedValue({ success: true, lastSaved: 12345 })
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

      expect(mocks.deploy).toHaveBeenCalledWith(
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
      expect(mocks.audit).not.toHaveBeenCalled()
    }
  )

  it('denies workspace API keys before canonical lookup for admin transitions', async () => {
    await expect(
      deployWorkflow.execute({
        principal: {
          kind: 'workspace_api_key',
          workspaceId: 'workspace-1',
          keyId: 'workspace-key',
        },
        input: { workflowId: 'workflow-1', requestId: 'request-1' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.resolveContext).not.toHaveBeenCalled()
    expect(mocks.deploy).not.toHaveBeenCalled()
  })

  it('admits runtime-principal deployment transitions through canonical authorization', async () => {
    await deployWorkflow.execute({
      principal: createTestRuntimePrincipal({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        rootWorkflowId: 'origin-workflow',
        executionId: 'execution-1',
      }),
      input: { workflowId: 'workflow-1', requestId: 'request-1' },
    })

    expect(mocks.resolveContext).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      assertedWorkspaceId: undefined,
    })
    expect(mocks.resolvePermission).toHaveBeenCalledWith('user-1', 'workspace-1', null, undefined, {
      forUpdate: undefined,
    })
    expect(mocks.assertMutable).toHaveBeenCalledWith('workflow-1')
    expect(mocks.deploy).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'workflow-1',
        userId: 'user-1',
        actorId: 'user-1',
        actor: {
          kind: 'session',
          userId: 'user-1',
        },
        captureAnalytics: false,
        requestId: 'request-1',
      })
    )
  })

  it('requires current admin permission before deployment', async () => {
    mocks.resolvePermission.mockResolvedValueOnce('write')

    await expect(
      deployWorkflow.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { workflowId: 'workflow-1', requestId: 'request-1' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.assertMutable).not.toHaveBeenCalled()
    expect(mocks.deploy).not.toHaveBeenCalled()
  })

  it('undeploys without legacy audit and projects one semantic audit entry', async () => {
    await undeployWorkflow.execute({
      principal: { kind: 'personal_api_key', userId: 'key-user', keyId: 'personal-key' },
      input: { workflowId: 'workflow-1', requestId: 'request-2' },
    })

    expect(mocks.undeploy).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      userId: 'key-user',
      actorId: 'key-user',
      projectLegacyAudit: false,
      requestId: 'request-2',
    })
    expect(mocks.audit).toHaveBeenCalledOnce()
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        actorId: 'key-user',
        action: 'workflow.undeployed',
        resourceType: 'workflow',
        resourceId: 'workflow-1',
        metadata: expect.objectContaining({ operation: 'workflows.undeploy' }),
      })
    )
  })

  it('projects revert audit and notification exactly once outside legacy orchestration', async () => {
    await revertWorkflowVersion.execute({
      principal: adminPrincipals[2].principal,
      input: { workflowId: 'workflow-1', version: 3 },
    })

    expect(mocks.revert).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'workflow-1',
        version: 3,
        userId: 'delegated-user',
        captureAnalytics: false,
        projectLegacyAudit: false,
        notifyRealtime: false,
      })
    )
    expect(mocks.audit).toHaveBeenCalledOnce()
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'workflow.deployment_reverted',
        resourceId: 'workflow-1',
        metadata: expect.objectContaining({ targetVersion: '3' }),
      })
    )
    expect(mocks.notifyReverted).toHaveBeenCalledOnce()
    expect(mocks.notifyReverted).toHaveBeenCalledWith('workflow-1', 12345)
  })

  it('keeps human activation analytics enabled for durable post-activation capture', async () => {
    await activateWorkflowVersion.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: {
        workflowId: 'workflow-1',
        version: 2,
        transition: 'activate',
        requestId: 'request-3',
        idempotencyKey: 'activation-1',
      },
    })

    expect(mocks.findPrevious).not.toHaveBeenCalled()
    expect(mocks.activate).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'workflow-1',
        version: 2,
        userId: 'user-1',
        actorId: 'user-1',
        requestId: 'request-3',
        idempotencyKey: 'activation-1',
      })
    )
  })

  it('forwards optional version metadata through the activation command', async () => {
    await activateWorkflowVersion.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: {
        workflowId: 'workflow-1',
        version: 2,
        transition: 'activate',
        requestId: 'request-metadata',
        name: 'Release 2',
        description: 'Production',
      },
    })

    expect(mocks.activate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Release 2',
        description: 'Production',
      })
    )
  })

  it('resolves the previous active version for an implicit rollback', async () => {
    const result = await activateWorkflowVersion.execute({
      principal: { kind: 'personal_api_key', userId: 'key-user', keyId: 'personal-key' },
      input: {
        workflowId: 'workflow-1',
        transition: 'rollback',
        requestId: 'request-4',
      },
    })

    expect(mocks.findPrevious).toHaveBeenCalledWith('workflow-1')
    expect(mocks.activate).toHaveBeenCalledWith(expect.objectContaining({ version: 3 }))
    expect(result.version).toBe(3)
  })

  it('rejects undeploy and rollback when the canonical workflow is not deployed', async () => {
    mocks.resolveContext.mockResolvedValue({
      ...context,
      workflow: { ...workflow, isDeployed: false },
    })
    const principal = { kind: 'session', userId: 'user-1', sessionId: 'session-1' } as const

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
    expect(mocks.undeploy).not.toHaveBeenCalled()
    expect(mocks.activate).not.toHaveBeenCalled()
  })

  it('allows explicit internal activation to redeploy an undeployed workflow', async () => {
    mocks.resolveContext.mockResolvedValue({
      ...context,
      workflow: { ...workflow, isDeployed: false },
    })

    await activateWorkflowVersion.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: {
        workflowId: 'workflow-1',
        version: 1,
        transition: 'activate',
        requestId: 'request-activation',
      },
    })

    expect(mocks.findPrevious).not.toHaveBeenCalled()
    expect(mocks.activate).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: 'workflow-1', version: 1 })
    )
  })

  it('maps lock failures and propagates manager infrastructure failures', async () => {
    mocks.assertMutable.mockRejectedValueOnce(new MockWorkflowLockedError('Workflow is locked'))

    await expect(
      deployWorkflow.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { workflowId: 'workflow-1', requestId: 'request-7' },
      })
    ).rejects.toMatchObject({ code: 'locked', message: 'Workflow is locked' })

    const infrastructureError = new Error('deployment manager unavailable')
    mocks.activate.mockRejectedValueOnce(infrastructureError)
    await expect(
      activateWorkflowVersion.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
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
    mocks.deploy.mockResolvedValueOnce({
      success: false,
      errorCode: 'internal',
      error: 'driver connection string',
    })

    await expect(
      deployWorkflow.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { workflowId: 'workflow-1', requestId: 'request-9' },
      })
    ).rejects.toThrow('Failed to deploy workflow')
  })
})
