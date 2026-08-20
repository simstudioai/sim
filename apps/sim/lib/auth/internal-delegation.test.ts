/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolveWorkflow, mockResolveRun, mockLoadDeployedWorkflowState } = vi.hoisted(() => ({
  mockResolveWorkflow: vi.fn(),
  mockResolveRun: vi.fn(),
  mockLoadDeployedWorkflowState: vi.fn(),
}))

vi.mock('@/lib/workflows/application/context', () => ({
  resolveActiveWorkflowApplicationContext: mockResolveWorkflow,
  resolveActiveWorkflowRunApplicationContext: mockResolveRun,
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadDeployedWorkflowState: mockLoadDeployedWorkflowState,
  NoActiveDeploymentError: class NoActiveDeploymentError extends Error {},
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
    mockLoadDeployedWorkflowState.mockResolvedValue({
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

  it('binds deployed child authority to the active deployment version', async () => {
    const currentWorkflow = {
      workflowId: 'child-workflow',
      mode: 'deployment' as const,
      deploymentVersionId: 'deployment-version-1',
    }

    const principal = await bindInternalExecutorDelegation(
      { ...claims, currentWorkflow },
      { audience: 'sim:credential-groups' }
    )

    expect(mockResolveWorkflow).toHaveBeenNthCalledWith(1, { workflowId: 'workflow-1' })
    expect(mockResolveWorkflow).toHaveBeenNthCalledWith(2, { workflowId: 'child-workflow' })
    expect(mockLoadDeployedWorkflowState).toHaveBeenCalledWith('child-workflow')
    expect(principal.delegationContext.currentWorkflow).toEqual(currentWorkflow)
  })

  it('rejects stale deployed child authority', async () => {
    mockLoadDeployedWorkflowState.mockResolvedValue({
      deploymentVersionId: 'deployment-version-2',
    })

    await expect(
      bindInternalExecutorDelegation(
        {
          ...claims,
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
    mockResolveWorkflow
      .mockResolvedValueOnce({ workflowId: 'workflow-1', workspaceId: 'workspace-1' })
      .mockResolvedValueOnce({ workflowId: 'child-workflow', workspaceId: 'workspace-2' })

    await expect(
      bindInternalExecutorDelegation(
        {
          ...claims,
          currentWorkflow: { workflowId: 'child-workflow', mode: 'draft' },
        },
        { audience: 'sim:credential-groups' }
      )
    ).rejects.toBeInstanceOf(InvalidInternalDelegationBindingError)
    expect(mockLoadDeployedWorkflowState).not.toHaveBeenCalled()
  })

  it('does not disguise current-workflow infrastructure failures as invalid credentials', async () => {
    const infrastructureError = new Error('deployment database unavailable')
    mockLoadDeployedWorkflowState.mockRejectedValue(infrastructureError)

    await expect(
      bindInternalExecutorDelegation(
        {
          ...claims,
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
