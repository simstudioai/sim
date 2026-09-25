import {
  dbChainMockFns,
  flattenMockConditions,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { asyncJobsMock, asyncJobsMockFns } from '@sim/testing/mocks/async-jobs.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/async-jobs', () => asyncJobsMock)
vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)

import {
  resolveActiveWorkflowApplicationContext,
  resolveActiveWorkflowDeploymentVersionApplicationContext,
  resolveActiveWorkflowExecutionApplicationContext,
  resolveActiveWorkflowRunApplicationContext,
} from '@/lib/workflows/application/context'

const mocks = {
  getJob: asyncJobsMockFns.mockJobQueue.getJob,
  getJobQueue: asyncJobsMockFns.mockGetJobQueue,
}

const mockLoadWorkspace = workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext

const workspace = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: 'organization-1',
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-user-1',
}
const workflow = { id: 'workflow-1', workspaceId: 'workspace-1', archivedAt: null }

function queueCanonicalBindings(input: { log?: string; paused?: string; resumed?: string }): void {
  queueTableRows(schemaMock.workflowExecutionLogs, input.log ? [{ workflowId: input.log }] : [])
  queueTableRows(schemaMock.pausedExecutions, input.paused ? [{ workflowId: input.paused }] : [])
  queueTableRows(schemaMock.resumeQueue, input.resumed ? [{ workflowId: input.resumed }] : [])
}

describe('workflow application contexts', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockLoadWorkspace.mockResolvedValue(workspace)
  })

  it('derives workflow authorization from its canonical active workspace', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { workflowId: 'workflow-1', workflow, workspaceId: 'workspace-1' },
    ])

    await expect(
      resolveActiveWorkflowApplicationContext({
        workflowId: 'workflow-1',
        assertedWorkspaceId: 'workspace-1',
      })
    ).resolves.toEqual({ ...workspace, workflowId: 'workflow-1', workflow })
    expect(mockLoadWorkspace).toHaveBeenCalledWith('workspace-1')
  })

  it('conceals an asserted workspace mismatch before loading workspace policy', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { workflowId: 'workflow-1', workflow, workspaceId: 'workspace-1' },
    ])

    await expect(
      resolveActiveWorkflowApplicationContext({
        workflowId: 'workflow-1',
        assertedWorkspaceId: 'workspace-2',
      })
    ).rejects.toMatchObject({ code: 'not_found', message: 'Workflow not found' })
    expect(mockLoadWorkspace).not.toHaveBeenCalled()
  })

  it('conceals an inactive canonical workspace as workflow absence', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { workflowId: 'workflow-1', workflow, workspaceId: 'workspace-1' },
    ])
    mockLoadWorkspace.mockResolvedValueOnce(null)

    await expect(
      resolveActiveWorkflowApplicationContext({ workflowId: 'workflow-1' })
    ).rejects.toMatchObject({ code: 'not_found', message: 'Workflow not found' })
  })

  it('fails hard when durable stores disagree about the canonical workflow binding', async () => {
    queueCanonicalBindings({ log: 'workflow-1', paused: 'workflow-2' })

    await expect(resolveActiveWorkflowRunApplicationContext({ runId: 'run-1' })).rejects.toThrow(
      'Run run-1 has conflicting canonical workflow bindings'
    )
    expect(mocks.getJobQueue).not.toHaveBeenCalled()
  })

  it('conceals a caller-asserted workflow that conflicts with the canonical binding', async () => {
    queueCanonicalBindings({ log: 'workflow-1' })

    await expect(
      resolveActiveWorkflowRunApplicationContext({
        runId: 'run-1',
        assertedWorkflowId: 'workflow-forged',
      })
    ).rejects.toMatchObject({ code: 'not_found', message: 'Run not found' })
  })

  it('binds live execution authority to the deployment version stored on its durable log', async () => {
    queueTableRows(schemaMock.workflowExecutionLogs, [
      {
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        deploymentVersionId: 'deployment-version-old',
      },
    ])
    queueTableRows(schemaMock.resumeQueue, [])
    queueTableRows(schemaMock.workflow, [
      {
        workflowId: 'workflow-1',
        workflow,
        workspaceId: 'workspace-1',
      },
    ])

    await expect(
      resolveActiveWorkflowExecutionApplicationContext({
        runId: 'run-1',
        assertedWorkflowId: 'workflow-1',
      })
    ).resolves.toMatchObject({
      runId: 'run-1',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      deploymentVersionId: 'deployment-version-old',
    })

    const conditions = flattenMockConditions(dbChainMockFns.where.mock.calls[0]?.[0])
    expect(conditions).toContainEqual({
      type: 'inArray',
      column: 'workflowExecutionLogs.status',
      values: ['running', 'pending', 'paused'],
    })
  })

  it('rejects execution authority without a live durable log', async () => {
    queueTableRows(schemaMock.workflowExecutionLogs, [])
    queueTableRows(schemaMock.resumeQueue, [])

    await expect(
      resolveActiveWorkflowExecutionApplicationContext({
        runId: 'run-1',
        assertedWorkflowId: 'workflow-1',
      })
    ).rejects.toMatchObject({ code: 'not_found', message: 'Run not found' })
    expect(mockLoadWorkspace).not.toHaveBeenCalled()
  })

  it('binds a claimed resume attempt to its parent durable execution log', async () => {
    queueTableRows(schemaMock.workflowExecutionLogs, [])
    queueTableRows(schemaMock.resumeQueue, [
      {
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        deploymentVersionId: 'deployment-version-old',
      },
    ])
    queueTableRows(schemaMock.workflow, [
      {
        workflowId: 'workflow-1',
        workflow,
        workspaceId: 'workspace-1',
      },
    ])

    await expect(
      resolveActiveWorkflowExecutionApplicationContext({
        runId: 'resume-execution-1',
        assertedWorkflowId: 'workflow-1',
      })
    ).resolves.toMatchObject({
      runId: 'resume-execution-1',
      deploymentVersionId: 'deployment-version-old',
    })

    const resumeConditions = flattenMockConditions(dbChainMockFns.where.mock.calls[1]?.[0])
    expect(resumeConditions).toContainEqual({
      type: 'eq',
      left: 'resumeQueue.newExecutionId',
      right: 'resume-execution-1',
    })
    expect(resumeConditions).toContainEqual({
      type: 'eq',
      left: 'resumeQueue.status',
      right: 'claimed',
    })
  })

  it('accepts an exact historical deployment version without requiring it to be active', async () => {
    queueTableRows(schemaMock.workflow, [
      {
        workflowId: 'workflow-1',
        workflow,
        workspaceId: 'workspace-1',
      },
    ])
    queueTableRows(schemaMock.workflowDeploymentVersion, [
      { deploymentVersionId: 'deployment-version-old' },
    ])

    await expect(
      resolveActiveWorkflowDeploymentVersionApplicationContext({
        workflowId: 'workflow-1',
        deploymentVersionId: 'deployment-version-old',
        assertedWorkspaceId: 'workspace-1',
      })
    ).resolves.toMatchObject({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      deploymentVersionId: 'deployment-version-old',
    })
  })

  it('rejects a deployment version that does not belong to the claimed workflow', async () => {
    queueTableRows(schemaMock.workflow, [
      {
        workflowId: 'workflow-1',
        workflow,
        workspaceId: 'workspace-1',
      },
    ])
    queueTableRows(schemaMock.workflowDeploymentVersion, [])

    await expect(
      resolveActiveWorkflowDeploymentVersionApplicationContext({
        workflowId: 'workflow-1',
        deploymentVersionId: 'deployment-version-forged',
        assertedWorkspaceId: 'workspace-1',
      })
    ).rejects.toMatchObject({
      code: 'not_found',
      message: 'Workflow deployment version not found',
    })
  })
})
