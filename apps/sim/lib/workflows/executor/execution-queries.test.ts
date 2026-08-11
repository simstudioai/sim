/**
 * @vitest-environment node
 */
import { queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing/mocks'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetJob, mockGetJobQueue } = vi.hoisted(() => ({
  mockGetJob: vi.fn(),
  mockGetJobQueue: vi.fn(),
}))

vi.mock('@/lib/core/async-jobs', () => ({
  getJobQueue: mockGetJobQueue,
}))

import { resolveWorkflowExecutionOwnership } from '@/lib/workflows/executor/execution-queries'

describe('resolveWorkflowExecutionOwnership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockGetJobQueue.mockResolvedValue({ getJob: mockGetJob })
  })

  it('accepts a durable execution bound to the requested workflow', async () => {
    queueTableRows(schemaMock.workflowExecutionLogs, [{ workflowId: 'workflow-1' }])

    await expect(
      resolveWorkflowExecutionOwnership('execution-1', 'workflow-1')
    ).resolves.toMatchObject({ belongsToWorkflow: true, workflowGroupWorkspaceId: null })
    expect(mockGetJobQueue).not.toHaveBeenCalled()
  })

  it('rejects a durable execution bound to another workflow', async () => {
    queueTableRows(schemaMock.workflowExecutionLogs, [{ workflowId: 'workflow-2' }])

    await expect(
      resolveWorkflowExecutionOwnership('execution-1', 'workflow-1')
    ).resolves.toMatchObject({ belongsToWorkflow: false })
    expect(mockGetJobQueue).not.toHaveBeenCalled()
  })

  it('projects the workflow-group workspace from the same log row it already reads', async () => {
    queueTableRows(schemaMock.workflowExecutionLogs, [
      { workflowId: 'workflow-1', workspaceId: 'workspace-1', executionOrigin: 'workflow_group' },
    ])

    await expect(
      resolveWorkflowExecutionOwnership('execution-1', 'workflow-1')
    ).resolves.toMatchObject({
      belongsToWorkflow: true,
      workflowGroupWorkspaceId: 'workspace-1',
    })
  })

  it('reports no group workspace for a standalone durable execution', async () => {
    queueTableRows(schemaMock.workflowExecutionLogs, [
      { workflowId: 'workflow-1', workspaceId: 'workspace-1', executionOrigin: null },
    ])

    await expect(
      resolveWorkflowExecutionOwnership('execution-1', 'workflow-1')
    ).resolves.toMatchObject({ workflowGroupWorkspaceId: null })
  })

  it('checks deterministic queue metadata before the durable log exists', async () => {
    mockGetJob.mockResolvedValue({ metadata: { workflowId: 'workflow-1' } })

    await expect(
      resolveWorkflowExecutionOwnership('execution-1', 'workflow-1')
    ).resolves.toMatchObject({ belongsToWorkflow: true, workflowGroupWorkspaceId: null })
    expect(mockGetJob).toHaveBeenCalledWith('workflow-execution:execution-1')
  })
})
