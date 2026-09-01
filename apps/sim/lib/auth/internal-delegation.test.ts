/**
 * @vitest-environment node
 */
import {
  bindPrincipalExecutionMetadata,
  enterPrincipalWorkflowExecution,
  type WorkflowExecutionPrincipal,
} from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolveWorkflow, mockResolveExecution, mockResolveDeploymentVersion } = vi.hoisted(
  () => ({
    mockResolveWorkflow: vi.fn(),
    mockResolveExecution: vi.fn(),
    mockResolveDeploymentVersion: vi.fn(),
  })
)

vi.mock('@/lib/workflows/application/context', () => ({
  resolveActiveWorkflowApplicationContext: mockResolveWorkflow,
  resolveActiveWorkflowExecutionApplicationContext: mockResolveExecution,
  resolveActiveWorkflowDeploymentVersionApplicationContext: mockResolveDeploymentVersion,
}))

import {
  bindInternalExecutorDelegation,
  InvalidInternalDelegationBindingError,
} from '@/lib/auth/internal-delegation'
import { OrchestrationError } from '@/lib/core/orchestration/types'

function rootPrincipal(
  principal: WorkflowExecutionPrincipal = {
    kind: 'session',
    userId: 'user-1',
    sessionId: 'session-1',
  }
) {
  return bindPrincipalExecutionMetadata(principal, {
    executionId: 'execution-1',
    rootWorkflowId: 'workflow-1',
    currentWorkflow: { workflowId: 'workflow-1', mode: 'draft' },
  })
}

function claims(principal = rootPrincipal()) {
  return {
    serviceId: 'executor' as const,
    principal,
    delegationId: 'delegation-1',
    issuedAt: new Date('2026-08-08T12:00:00.000Z'),
    expiresAt: new Date('2026-08-08T12:05:00.000Z'),
  }
}

describe('bindInternalExecutorDelegation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveWorkflow.mockResolvedValue({
      workflowId: 'child-workflow',
      workspaceId: 'workspace-1',
    })
    mockResolveExecution.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      runId: 'execution-1',
      deploymentVersionId: null,
    })
    mockResolveDeploymentVersion.mockResolvedValue({
      workflowId: 'child-workflow',
      workspaceId: 'workspace-1',
      deploymentVersionId: 'deployment-version-1',
    })
  })

  it('revalidates the canonical run and returns the same semantic runtime principal', async () => {
    const principal = rootPrincipal()

    await expect(bindInternalExecutorDelegation(claims(principal))).resolves.toBe(principal)
    expect(mockResolveExecution).toHaveBeenCalledWith({
      runId: 'execution-1',
      assertedWorkflowId: 'workflow-1',
    })
  })

  it.each([
    {
      name: 'workspace API key',
      principal: {
        kind: 'workspace_api_key' as const,
        workspaceId: 'workspace-1',
        keyId: 'key-1',
      },
    },
    {
      name: 'schedule',
      principal: {
        kind: 'system' as const,
        serviceId: 'schedule' as const,
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
      },
    },
    {
      name: 'generic webhook',
      principal: {
        kind: 'system' as const,
        serviceId: 'webhook' as const,
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        webhookId: 'webhook-1',
        provider: 'generic',
      },
    },
    {
      name: 'Slack subject',
      principal: {
        kind: 'system' as const,
        serviceId: 'webhook' as const,
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        webhookId: 'webhook-1',
        provider: 'slack',
        subject: {
          kind: 'external_user' as const,
          provider: 'slack',
          tenantId: 'T123',
          subjectId: 'U123',
        },
      },
    },
  ])('preserves the original actor for $name', async ({ principal }) => {
    const runtimePrincipal = rootPrincipal(principal)

    await expect(bindInternalExecutorDelegation(claims(runtimePrincipal))).resolves.toBe(
      runtimePrincipal
    )
  })

  it('binds a deployed child to its exact historical deployment version', async () => {
    const principal = enterPrincipalWorkflowExecution(rootPrincipal(), {
      workflowId: 'child-workflow',
      mode: 'deployment',
      deploymentVersionId: 'deployment-version-1',
    })

    await expect(bindInternalExecutorDelegation(claims(principal))).resolves.toBe(principal)
    expect(mockResolveDeploymentVersion).toHaveBeenCalledWith({
      workflowId: 'child-workflow',
      deploymentVersionId: 'deployment-version-1',
      assertedWorkspaceId: 'workspace-1',
    })
  })

  it('binds a regular draft child in the canonical root workspace', async () => {
    const principal = enterPrincipalWorkflowExecution(rootPrincipal(), {
      workflowId: 'child-workflow',
      mode: 'draft',
    })

    await expect(bindInternalExecutorDelegation(claims(principal))).resolves.toBe(principal)
    expect(mockResolveWorkflow).toHaveBeenCalledWith({
      workflowId: 'child-workflow',
      assertedWorkspaceId: 'workspace-1',
    })
  })

  it('rejects a deployed child version that is not canonical', async () => {
    mockResolveDeploymentVersion.mockRejectedValue(
      new OrchestrationError('not_found', 'Workflow deployment version not found')
    )
    const principal = enterPrincipalWorkflowExecution(rootPrincipal(), {
      workflowId: 'child-workflow',
      mode: 'deployment',
      deploymentVersionId: 'deployment-version-1',
    })

    await expect(bindInternalExecutorDelegation(claims(principal))).rejects.toBeInstanceOf(
      InvalidInternalDelegationBindingError
    )
  })

  it('rejects a regular child outside the canonical workspace', async () => {
    mockResolveWorkflow.mockRejectedValue(
      new OrchestrationError('not_found', 'Workflow not found in workspace')
    )
    const principal = enterPrincipalWorkflowExecution(rootPrincipal(), {
      workflowId: 'child-workflow',
      mode: 'draft',
    })

    await expect(bindInternalExecutorDelegation(claims(principal))).rejects.toBeInstanceOf(
      InvalidInternalDelegationBindingError
    )
  })

  it('rejects a principal whose own workspace disagrees with the canonical run', async () => {
    const principal = rootPrincipal({
      kind: 'workspace_api_key',
      workspaceId: 'workspace-2',
      keyId: 'key-1',
    })

    await expect(bindInternalExecutorDelegation(claims(principal))).rejects.toBeInstanceOf(
      InvalidInternalDelegationBindingError
    )
  })

  it('binds root deployment authority to the immutable version recorded on the run', async () => {
    mockResolveExecution.mockResolvedValueOnce({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      runId: 'execution-1',
      deploymentVersionId: 'deployment-version-1',
    })
    const principal = bindPrincipalExecutionMetadata(
      { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      {
        executionId: 'execution-1',
        rootWorkflowId: 'workflow-1',
        currentWorkflow: {
          workflowId: 'workflow-1',
          mode: 'deployment',
          deploymentVersionId: 'deployment-version-1',
        },
      }
    )

    await expect(bindInternalExecutorDelegation(claims(principal))).resolves.toBe(principal)
    expect(mockResolveDeploymentVersion).not.toHaveBeenCalled()
  })

  it('rejects root authority that disagrees with the durable run mode or version', async () => {
    mockResolveExecution.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      runId: 'execution-1',
      deploymentVersionId: 'deployment-version-2',
    })

    await expect(bindInternalExecutorDelegation(claims(rootPrincipal()))).rejects.toBeInstanceOf(
      InvalidInternalDelegationBindingError
    )
  })

  it('classifies a missing canonical execution as an invalid binding', async () => {
    mockResolveExecution.mockRejectedValue(
      new OrchestrationError('not_found', 'Workflow run not found')
    )

    await expect(bindInternalExecutorDelegation(claims())).rejects.toBeInstanceOf(
      InvalidInternalDelegationBindingError
    )
  })

  it('does not disguise canonical-load infrastructure failures as invalid credentials', async () => {
    const infrastructureError = new Error('database unavailable')
    mockResolveExecution.mockRejectedValue(infrastructureError)

    await expect(bindInternalExecutorDelegation(claims())).rejects.toBe(infrastructureError)
  })
})
