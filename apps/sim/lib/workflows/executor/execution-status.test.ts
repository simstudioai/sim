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

  it('uses the resume entry ID when the queued work is a resume attempt', async () => {
    queueTableRows(schemaMock.resumeQueue, [{ id: 'resume-entry-1' }])
    mockGetJob.mockResolvedValueOnce({
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
    expect(mockGetJob).toHaveBeenCalledWith('resume-execution:resume-entry-1')
  })

  it('projects an active resume ahead of the existing paused log', async () => {
    queueTableRows(schemaMock.workflowExecutionLogs, [
      {
        executionId: 'execution-1',
        workflowId: 'workflow-1',
        status: 'paused',
      },
    ])
    queueTableRows(schemaMock.resumeQueue, [{ id: 'resume-entry-1' }])
    mockGetJob.mockResolvedValueOnce({
      status: 'pending',
      createdAt: new Date('2026-08-05T12:00:00.000Z'),
      metadata: { workflowId: 'workflow-1' },
    })

    const status = await getWorkflowExecutionStatus(input)

    expect(status).toMatchObject({
      executionId: 'execution-1',
      status: 'queued',
      paused: null,
    })
  })

  it('keeps an active resume queued while its background job is not yet visible', async () => {
    queueTableRows(schemaMock.workflowExecutionLogs, [
      {
        executionId: 'execution-1',
        workflowId: 'workflow-1',
        status: 'paused',
        trigger: 'api',
      },
    ])
    queueTableRows(schemaMock.resumeQueue, [
      {
        id: 'resume-entry-1',
        queuedAt: new Date('2026-08-05T12:00:00.000Z'),
        claimedAt: new Date('2026-08-05T12:00:01.000Z'),
      },
    ])
    mockGetJob.mockResolvedValueOnce(null)

    const status = await getWorkflowExecutionStatus(input)

    expect(status).toMatchObject({
      executionId: 'execution-1',
      status: 'queued',
      trigger: 'api',
      startedAt: '2026-08-05T12:00:01.000Z',
      paused: null,
    })
  })

  it('returns completed queue output when requested', async () => {
    mockGetJob.mockResolvedValueOnce({
      status: 'completed',
      createdAt: new Date('2026-08-05T12:00:00.000Z'),
      completedAt: new Date('2026-08-05T12:00:05.000Z'),
      output: { output: { answer: 42 } },
      metadata: { workflowId: 'workflow-1' },
    })

    const status = await getWorkflowExecutionStatus({ ...input, includeOutput: true })

    expect(status).toMatchObject({
      status: 'completed',
      finalOutput: { answer: 42 },
    })
  })

  it('does not expose a queue record belonging to another workflow', async () => {
    mockGetJob.mockResolvedValueOnce({
      status: 'pending',
      createdAt: new Date('2026-08-05T12:00:00.000Z'),
      metadata: { workflowId: 'workflow-2' },
    })

    await expect(getWorkflowExecutionStatus(input)).resolves.toBeNull()
  })
})
