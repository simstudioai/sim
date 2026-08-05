/**
 * @vitest-environment node
 */
import { queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetJob } = vi.hoisted(() => ({
  mockGetJob: vi.fn(),
}))

vi.mock('@/lib/core/async-jobs', () => ({
  getJobQueue: vi.fn().mockResolvedValue({ getJob: mockGetJob }),
}))

vi.mock('@/lib/workflows/executor/enqueue-execution', () => ({
  RESUME_EXECUTION_JOB_ID_PREFIX: 'resume-execution:',
  WORKFLOW_EXECUTION_JOB_ID_PREFIX: 'workflow-execution:',
}))

import { getWorkflowExecutionStatus } from '@/lib/workflows/executor/execution-status'

const input = {
  workflowId: 'workflow-1',
  executionId: 'execution-1',
  includeOutput: false,
  selectedOutputs: [],
}

describe('getWorkflowExecutionStatus queue projection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    queueTableRows(schemaMock.workflowExecutionLogs, [])
  })

  it('projects a queued workflow job as an execution resource', async () => {
    mockGetJob.mockResolvedValue({
      status: 'pending',
      createdAt: new Date('2026-08-05T12:00:00.000Z'),
      metadata: {
        workflowId: 'workflow-1',
        correlation: { triggerType: 'api' },
      },
    })

    const status = await getWorkflowExecutionStatus(input)

    expect(status).toMatchObject({
      executionId: 'execution-1',
      workflowId: 'workflow-1',
      status: 'queued',
      trigger: 'api',
      startedAt: '2026-08-05T12:00:00.000Z',
      endedAt: null,
      error: null,
    })
    expect(mockGetJob).toHaveBeenCalledWith('workflow-execution:execution-1')
  })

  it('uses the resume execution ID when the queued work is a resume attempt', async () => {
    mockGetJob.mockResolvedValueOnce(null).mockResolvedValueOnce({
      status: 'processing',
      createdAt: new Date('2026-08-05T12:00:00.000Z'),
      startedAt: new Date('2026-08-05T12:00:01.000Z'),
      metadata: { workflowId: 'workflow-1' },
    })

    const status = await getWorkflowExecutionStatus(input)

    expect(status).toMatchObject({
      executionId: 'execution-1',
      workflowId: 'workflow-1',
      status: 'running',
      startedAt: '2026-08-05T12:00:01.000Z',
    })
    expect(mockGetJob).toHaveBeenNthCalledWith(2, 'resume-execution:execution-1')
  })

  it('does not expose a queue record belonging to another workflow', async () => {
    mockGetJob
      .mockResolvedValueOnce({
        status: 'pending',
        createdAt: new Date('2026-08-05T12:00:00.000Z'),
        metadata: { workflowId: 'workflow-2' },
      })
      .mockResolvedValueOnce(null)

    await expect(getWorkflowExecutionStatus(input)).resolves.toBeNull()
  })
})
