/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolveWorkflow, mockResolveRun, mockResolveExecution, mockResolveDeploymentVersion } =
  vi.hoisted(() => ({
    mockResolveWorkflow: vi.fn(),
    mockResolveRun: vi.fn(),
    mockResolveExecution: vi.fn(),
    mockResolveDeploymentVersion: vi.fn(),
  }))

vi.mock('@/lib/workflows/application/context', () => ({
  resolveActiveWorkflowApplicationContext: mockResolveWorkflow,
  resolveActiveWorkflowRunApplicationContext: mockResolveRun,
  resolveActiveWorkflowExecutionApplicationContext: mockResolveExecution,
  resolveActiveWorkflowDeploymentVersionApplicationContext: mockResolveDeploymentVersion,
}))

import {
  bindInternalExecutorDelegation,
  InvalidInternalDelegationBindingError,
} from '@/lib/auth/internal-delegation'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const claims = {
  serviceId: 'executor' as const,
  subjectUserId: 'user-1',
  workflowId: 'workflow-1',
  delegationId: 'delegation-1',
  issuedAt: new Date('2026-08-08T12:00:00.000Z'),
  expiresAt: new Date('2026-08-08T12:05:00.000Z'),
}

describe('bindInternalExecutorDelegation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveWorkflow.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
    })
    mockResolveRun.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      runId: 'execution-1',
    })
    mockResolveExecution.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      runId: 'execution-1',
      deploymentVersionId: 'deployment-version-1',
    })
    mockResolveDeploymentVersion.mockResolvedValue({
      workflowId: 'child-workflow',
      workspaceId: 'workspace-1',
      deploymentVersionId: 'deployment-version-1',
    })
  })

  it('derives workspace authority from the canonical workflow', async () => {
    await expect(
      bindInternalExecutorDelegation(claims, { audience: 'sim:knowledge' })
    ).resolves.toEqual({
      kind: 'delegated',
      serviceId: 'executor',
      subjectUserId: 'user-1',
      workspaceId: 'workspace-1',
      delegationId: 'delegation-1',
      audience: 'sim:knowledge',
      issuedAt: claims.issuedAt,
      expiresAt: claims.expiresAt,
      delegationContext: {
        kind: 'workflow_execution',
        workflowId: 'workflow-1',
      },
    })
    expect(mockResolveWorkflow).toHaveBeenCalledWith({ workflowId: 'workflow-1' })
    expect(mockResolveRun).not.toHaveBeenCalled()
  })

  it('canonically binds an execution to its signed workflow', async () => {
    const executionClaims = { ...claims, executionId: 'execution-1' }

    const principal = await bindInternalExecutorDelegation(executionClaims, {
      audience: 'sim:workspace-files',
      resourceScope: { fileId: 'file-1' },
    })

    expect(mockResolveRun).toHaveBeenCalledWith({
      runId: 'execution-1',
      assertedWorkflowId: 'workflow-1',
    })
    expect(principal).toMatchObject({
      workspaceId: 'workspace-1',
      resourceScope: { fileId: 'file-1' },
      delegationContext: {
        kind: 'workflow_execution',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      },
    })
  })

  it('binds deployed child authority to its exact historical deployment version', async () => {
    const currentWorkflow = {
      workflowId: 'child-workflow',
      mode: 'deployment' as const,
      deploymentVersionId: 'deployment-version-1',
    }

    const principal = await bindInternalExecutorDelegation(
      { ...claims, executionId: 'execution-1', currentWorkflow },
      { audience: 'sim:credential-groups' }
    )

    expect(mockResolveExecution).toHaveBeenCalledWith({
      runId: 'execution-1',
      assertedWorkflowId: 'workflow-1',
    })
    expect(mockResolveDeploymentVersion).toHaveBeenCalledWith({
      workflowId: 'child-workflow',
      deploymentVersionId: 'deployment-version-1',
      assertedWorkspaceId: 'workspace-1',
    })
    expect(principal.delegationContext.currentWorkflow).toEqual(currentWorkflow)
  })

  it('rejects a deployed child version that does not belong to the claimed workflow', async () => {
    mockResolveDeploymentVersion.mockRejectedValue(
      new OrchestrationError('not_found', 'Workflow deployment version not found')
    )

    await expect(
      bindInternalExecutorDelegation(
        {
          ...claims,
          executionId: 'execution-1',
          currentWorkflow: {
            workflowId: 'child-workflow',
            mode: 'deployment',
            deploymentVersionId: 'deployment-version-1',
          },
        },
        { audience: 'sim:credential-groups' }
      )
    ).rejects.toBeInstanceOf(InvalidInternalDelegationBindingError)
  })

  it('rejects current workflow authority from another workspace', async () => {
    mockResolveWorkflow.mockResolvedValueOnce({
      workflowId: 'child-workflow',
      workspaceId: 'workspace-2',
    })

    await expect(
      bindInternalExecutorDelegation(
        {
          ...claims,
          executionId: 'execution-1',
          currentWorkflow: { workflowId: 'child-workflow', mode: 'draft' },
        },
        { audience: 'sim:credential-groups' }
      )
    ).rejects.toBeInstanceOf(InvalidInternalDelegationBindingError)
    expect(mockResolveDeploymentVersion).not.toHaveBeenCalled()
  })

  it('does not disguise current-workflow infrastructure failures as invalid credentials', async () => {
    const infrastructureError = new Error('deployment database unavailable')
    mockResolveDeploymentVersion.mockRejectedValue(infrastructureError)

    await expect(
      bindInternalExecutorDelegation(
        {
          ...claims,
          executionId: 'execution-1',
          currentWorkflow: {
            workflowId: 'child-workflow',
            mode: 'deployment',
            deploymentVersionId: 'deployment-version-1',
          },
        },
        { audience: 'sim:credential-groups' }
      )
    ).rejects.toBe(infrastructureError)
  })

  it('rejects current workflow authority without a canonical execution binding', async () => {
    await expect(
      bindInternalExecutorDelegation(
        {
          ...claims,
          currentWorkflow: { workflowId: 'workflow-1', mode: 'draft' },
        },
        { audience: 'sim:credential-groups' }
      )
    ).rejects.toBeInstanceOf(InvalidInternalDelegationBindingError)

    expect(mockResolveExecution).not.toHaveBeenCalled()
  })

  it('binds root deployment authority to the immutable version recorded on the run', async () => {
    const currentWorkflow = {
      workflowId: 'workflow-1',
      mode: 'deployment' as const,
      deploymentVersionId: 'deployment-version-1',
    }

    const principal = await bindInternalExecutorDelegation(
      { ...claims, executionId: 'execution-1', currentWorkflow },
      { audience: 'sim:credential-groups' }
    )

    expect(principal.delegationContext.currentWorkflow).toEqual(currentWorkflow)
    expect(mockResolveDeploymentVersion).not.toHaveBeenCalled()
  })

  it('rejects root deployment authority that disagrees with the durable run version', async () => {
    mockResolveExecution.mockResolvedValueOnce({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      runId: 'execution-1',
      deploymentVersionId: 'deployment-version-new',
    })

    await expect(
      bindInternalExecutorDelegation(
        {
          ...claims,
          executionId: 'execution-1',
          currentWorkflow: {
            workflowId: 'workflow-1',
            mode: 'deployment',
            deploymentVersionId: 'deployment-version-old',
          },
        },
        { audience: 'sim:credential-groups' }
      )
    ).rejects.toBeInstanceOf(InvalidInternalDelegationBindingError)
  })

  it('rejects draft root authority for a durably deployed run', async () => {
    await expect(
      bindInternalExecutorDelegation(
        {
          ...claims,
          executionId: 'execution-1',
          currentWorkflow: { workflowId: 'workflow-1', mode: 'draft' },
        },
        { audience: 'sim:credential-groups' }
      )
    ).rejects.toBeInstanceOf(InvalidInternalDelegationBindingError)
  })

  it('fails before canonical loading when the domain audience is missing', async () => {
    await expect(bindInternalExecutorDelegation(claims, { audience: ' ' })).rejects.toThrow(
      'Internal delegation audience must not be empty'
    )
    expect(mockResolveWorkflow).not.toHaveBeenCalled()
  })

  it('classifies a missing canonical execution as an invalid delegation binding', async () => {
    mockResolveRun.mockRejectedValue(new OrchestrationError('not_found', 'Workflow run not found'))

    await expect(
      bindInternalExecutorDelegation(
        { ...claims, executionId: 'execution-1' },
        { audience: 'sim:workspace-files' }
      )
    ).rejects.toBeInstanceOf(InvalidInternalDelegationBindingError)
  })

  it('does not disguise canonical-load infrastructure failures as invalid credentials', async () => {
    const infrastructureError = new Error('database unavailable')
    mockResolveWorkflow.mockRejectedValue(infrastructureError)

    await expect(
      bindInternalExecutorDelegation(claims, { audience: 'sim:workspace-files' })
    ).rejects.toBe(infrastructureError)
  })
})
