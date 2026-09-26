import { queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing/mocks'
import { asyncJobsMock, asyncJobsMockFns } from '@sim/testing/mocks/async-jobs.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/async-jobs', () => asyncJobsMock)

import { resolveWorkflowExecutionOwnership } from '@/lib/workflows/executor/execution-queries'

const mockGetJob = asyncJobsMockFns.mockJobQueue.getJob
const { mockGetJobQueue } = asyncJobsMockFns

describe('resolveWorkflowExecutionOwnership', () => {
  beforeEach(() => {
    resetDbChainMock()
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

  /**
   * A run that paused before its log row landed — or whose log row is gone — is
   * still durable, and the paused row's workflow id is the only thing standing
   * between it and the queue fallback, which would answer `false` for a run the
   * queue no longer holds. Nothing else here queues a `pausedExecutions` row, so
   * dropping it from the ownership decision is otherwise invisible.
   */
  it('resolves ownership from a paused-only execution', async () => {
    queueTableRows(schemaMock.workflowExecutionLogs, [])
    queueTableRows(schemaMock.pausedExecutions, [{ workflowId: 'workflow-1' }])

    await expect(
      resolveWorkflowExecutionOwnership('execution-1', 'workflow-1')
    ).resolves.toMatchObject({
      belongsToWorkflow: true,
      workflowGroupWorkspaceId: null,
      priorStatus: null,
    })
    expect(mockGetJobQueue).not.toHaveBeenCalled()
  })

  it('rejects a paused-only execution bound to another workflow', async () => {
    queueTableRows(schemaMock.workflowExecutionLogs, [])
    queueTableRows(schemaMock.pausedExecutions, [{ workflowId: 'workflow-2' }])

    await expect(
      resolveWorkflowExecutionOwnership('execution-1', 'workflow-1')
    ).resolves.toMatchObject({ belongsToWorkflow: false })
    expect(mockGetJobQueue).not.toHaveBeenCalled()
  })

  it('checks deterministic queue metadata before the durable log exists', async () => {
    mockGetJob.mockResolvedValue({ metadata: { workflowId: 'workflow-1' } })

    await expect(
      resolveWorkflowExecutionOwnership('execution-1', 'workflow-1')
    ).resolves.toMatchObject({
      belongsToWorkflow: true,
      workflowGroupWorkspaceId: null,
      priorStatus: null,
    })
    expect(mockGetJob).toHaveBeenCalledWith('workflow-execution:execution-1')
  })
})
