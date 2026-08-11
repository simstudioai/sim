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

import { workflowExecutionBelongsToWorkflow } from '@/lib/workflows/executor/execution-queries'

describe('workflowExecutionBelongsToWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockGetJobQueue.mockResolvedValue({ getJob: mockGetJob })
  })

  it('accepts a durable execution bound to the requested workflow', async () => {
    queueTableRows(schemaMock.workflowExecutionLogs, [{ workflowId: 'workflow-1' }])

    await expect(workflowExecutionBelongsToWorkflow('execution-1', 'workflow-1')).resolves.toBe(
      true
    )
    expect(mockGetJobQueue).not.toHaveBeenCalled()
  })

  it('rejects a durable execution bound to another workflow', async () => {
    queueTableRows(schemaMock.workflowExecutionLogs, [{ workflowId: 'workflow-2' }])

    await expect(workflowExecutionBelongsToWorkflow('execution-1', 'workflow-1')).resolves.toBe(
      false
    )
    expect(mockGetJobQueue).not.toHaveBeenCalled()
  })

  it('checks deterministic queue metadata before the durable log exists', async () => {
    mockGetJob.mockResolvedValue({ metadata: { workflowId: 'workflow-1' } })

    await expect(workflowExecutionBelongsToWorkflow('execution-1', 'workflow-1')).resolves.toBe(
      true
    )
    expect(mockGetJob).toHaveBeenCalledWith('workflow-execution:execution-1')
  })
})
