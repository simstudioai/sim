/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing/mocks'
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

  /**
   * A cancel has to tell a live run apart from one that had already finished,
   * and the row it would ask for is the row this query already reads.
   */
  it('projects the durable status from the same log row it already reads', async () => {
    queueTableRows(schemaMock.workflowExecutionLogs, [
      { workflowId: 'workflow-1', status: 'completed' },
    ])

    await expect(
      resolveWorkflowExecutionOwnership('execution-1', 'workflow-1')
    ).resolves.toMatchObject({ belongsToWorkflow: true, priorStatus: 'completed' })
  })

  /**
   * The row-queue mock returns whatever was queued for a table regardless of the
   * predicate, so every other test here passes with the `WHERE` deleted. Execution
   * ids are globally unique but nothing in the mock enforces that a lookup keyed
   * on the wrong column — or on nothing — would fail, and this resolver is what
   * every mutating caller trusts to say which workflow an execution belongs to.
   */
  it('keys both durable reads on the execution id', async () => {
    queueTableRows(schemaMock.workflowExecutionLogs, [{ workflowId: 'workflow-1' }])

    await resolveWorkflowExecutionOwnership('execution-1', 'workflow-1')

    expect(dbChainMockFns.from).toHaveBeenNthCalledWith(1, schemaMock.workflowExecutionLogs)
    expect(dbChainMockFns.from).toHaveBeenNthCalledWith(2, schemaMock.pausedExecutions)
    expect(dbChainMockFns.where).toHaveBeenNthCalledWith(1, {
      type: 'eq',
      left: schemaMock.workflowExecutionLogs.executionId,
      right: 'execution-1',
    })
    expect(dbChainMockFns.where).toHaveBeenNthCalledWith(2, {
      type: 'eq',
      left: schemaMock.pausedExecutions.executionId,
      right: 'execution-1',
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
