/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { and } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetJob, mockMaterializeForDisplayWithBlockOutputs } = vi.hoisted(() => ({
  mockGetJob: vi.fn(),
  mockMaterializeForDisplayWithBlockOutputs: vi.fn(),
}))

vi.mock('@/lib/core/async-jobs', () => ({
  getJobQueue: vi.fn().mockResolvedValue({ getJob: mockGetJob }),
}))

vi.mock('@/lib/logs/execution/trace-store', () => ({
  materializeExecutionDataForDisplayWithBlockOutputs: mockMaterializeForDisplayWithBlockOutputs,
}))

vi.mock('@/lib/workflows/executor/paused-execution-metadata', () => ({
  getAutomaticResumeWaitingMetadata: vi.fn().mockReturnValue(null),
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
    mockMaterializeForDisplayWithBlockOutputs.mockResolvedValue({
      executionData: {},
      blockOutputs: new Map(),
    })
  })

  it('selects run outputs only from the secret-safe display projection', async () => {
    queueTableRows(schemaMock.workflowExecutionLogs, [
      {
        executionId: 'execution-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        status: 'completed',
        level: 'info',
        trigger: 'api',
        startedAt: new Date('2026-08-05T12:00:00.000Z'),
        endedAt: new Date('2026-08-05T12:00:01.000Z'),
        totalDurationMs: 1000,
        executionData: {
          executionState: {
            blockStates: { 'block-1': { output: { token: 'resolved-secret' } } },
          },
        },
        costTotal: null,
      },
    ])
    queueTableRows(schemaMock.resumeQueue, [])
    queueTableRows(schemaMock.pausedExecutions, [])
    mockMaterializeForDisplayWithBlockOutputs.mockResolvedValueOnce({
      executionData: { finalOutput: { token: '[REDACTED]' } },
      blockOutputs: new Map([['block-1', { token: '[REDACTED]' }]]),
    })
    const status = await getWorkflowExecutionStatus({
      ...input,
      includeOutput: true,
      selectedOutputs: ['block-1'],
    })

    expect(mockMaterializeForDisplayWithBlockOutputs).toHaveBeenCalledWith(
      expect.objectContaining({ executionState: expect.anything() }),
      {
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      },
      ['block-1']
    )
    expect(status).toMatchObject({
      finalOutput: { token: '[REDACTED]' },
      blockOutputs: { 'block-1': { token: '[REDACTED]' } },
    })
    expect(JSON.stringify(status)).not.toContain('resolved-secret')
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

  it('preserves queue cancellation as a cancelled execution resource', async () => {
    mockGetJob.mockResolvedValue({
      status: 'cancelled',
      createdAt: new Date('2026-08-05T12:00:00.000Z'),
      completedAt: new Date('2026-08-05T12:00:01.000Z'),
      metadata: { workflowId: 'workflow-1' },
    })

    const status = await getWorkflowExecutionStatus(input)

    expect(status).toMatchObject({
      executionId: 'execution-1',
      status: 'cancelled',
      level: 'info',
      endedAt: '2026-08-05T12:00:01.000Z',
      totalDurationMs: 1000,
      error: null,
    })
  })

  it('uses the resume entry ID when the queued work is a resume attempt', async () => {
    queueTableRows(schemaMock.resumeQueue, [{ id: 'resume-entry-1', status: 'claimed' }])
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

    type MockPredicate = { type: string; left?: unknown; right?: unknown }
    const activeResumePredicates = vi
      .mocked(and)
      .mock.calls.find((conditions) =>
        (conditions as MockPredicate[]).some(
          (condition) => condition.left === schemaMock.resumeQueue.newExecutionId
        )
      ) as MockPredicate[] | undefined
    expect(activeResumePredicates).toEqual(
      expect.arrayContaining([
        {
          type: 'eq',
          left: schemaMock.resumeQueue.newExecutionId,
          right: input.executionId,
        },
        {
          type: 'eq',
          left: schemaMock.pausedExecutions.workflowId,
          right: input.workflowId,
        },
      ])
    )
    expect(activeResumePredicates).not.toContainEqual(
      expect.objectContaining({ left: schemaMock.resumeQueue.parentExecutionId })
    )
    expect(dbChainMockFns.innerJoin).toHaveBeenCalledWith(schemaMock.pausedExecutions, {
      type: 'eq',
      left: schemaMock.resumeQueue.pausedExecutionId,
      right: schemaMock.pausedExecutions.id,
    })
  })

  it('projects an active resume ahead of the existing paused log', async () => {
    queueTableRows(schemaMock.workflowExecutionLogs, [
      {
        executionId: 'execution-1',
        workflowId: 'workflow-1',
        status: 'paused',
      },
    ])
    queueTableRows(schemaMock.resumeQueue, [{ id: 'resume-entry-1', status: 'claimed' }])
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
        status: 'claimed',
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

  it('projects a pending serialized resume as queued', async () => {
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
        id: 'resume-entry-2',
        status: 'pending',
        queuedAt: new Date('2026-08-05T12:00:02.000Z'),
        claimedAt: null,
      },
    ])

    const status = await getWorkflowExecutionStatus(input)

    expect(status).toMatchObject({
      executionId: 'execution-1',
      status: 'queued',
      startedAt: '2026-08-05T12:00:02.000Z',
      paused: null,
    })
    expect(mockGetJob).not.toHaveBeenCalled()
  })

  it('does not let an orphaned pending resume mask a terminal log', async () => {
    queueTableRows(schemaMock.workflowExecutionLogs, [
      {
        executionId: 'execution-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        status: 'completed',
        level: 'info',
        trigger: 'api',
        startedAt: new Date('2026-08-05T12:00:00.000Z'),
        endedAt: new Date('2026-08-05T12:00:01.000Z'),
        totalDurationMs: 1000,
        executionData: null,
        costTotal: null,
      },
    ])
    queueTableRows(schemaMock.resumeQueue, [
      {
        id: 'resume-entry-2',
        status: 'pending',
        queuedAt: new Date('2026-08-05T12:00:02.000Z'),
        claimedAt: null,
      },
    ])

    const status = await getWorkflowExecutionStatus(input)

    expect(status).toMatchObject({
      executionId: 'execution-1',
      status: 'completed',
    })
    expect(mockGetJob).not.toHaveBeenCalled()
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

  it('exposes the active pause context required by resume', async () => {
    queueTableRows(schemaMock.workflowExecutionLogs, [
      {
        executionId: 'execution-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        status: 'paused',
        level: 'info',
        trigger: 'api',
        startedAt: new Date('2026-08-05T12:00:00.000Z'),
        endedAt: null,
        totalDurationMs: null,
        executionData: null,
        costTotal: null,
      },
    ])
    queueTableRows(schemaMock.resumeQueue, [])
    queueTableRows(schemaMock.pausedExecutions, [
      {
        id: 'paused-execution-1',
        status: 'paused',
        pausePoints: {
          'context-1': {
            contextId: 'context-1',
            blockId: 'approval-block',
            response: null,
            registeredAt: '2026-08-05T12:00:01.000Z',
            resumeStatus: 'paused',
            snapshotReady: true,
            pauseKind: 'human',
          },
        },
        metadata: {},
        resumedCount: 0,
        pausedAt: new Date('2026-08-05T12:00:01.000Z'),
        nextResumeAt: null,
      },
    ])

    const status = await getWorkflowExecutionStatus(input)

    expect(status?.paused).toMatchObject({
      contextId: 'context-1',
      pauseKind: 'human',
      blockedOnBlockId: 'approval-block',
    })
  })

  it('returns null pause coordinates while every pause point is mid-resume', async () => {
    queueTableRows(schemaMock.workflowExecutionLogs, [
      {
        executionId: 'execution-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        status: 'paused',
        level: 'info',
        trigger: 'api',
        startedAt: new Date('2026-08-05T12:00:00.000Z'),
        endedAt: null,
        totalDurationMs: null,
        executionData: null,
        costTotal: null,
      },
    ])
    queueTableRows(schemaMock.resumeQueue, [])
    queueTableRows(schemaMock.pausedExecutions, [
      {
        id: 'paused-execution-1',
        status: 'partially_resumed',
        pausePoints: {
          'context-1': {
            contextId: 'context-1',
            blockId: 'approval-block',
            response: null,
            registeredAt: '2026-08-05T12:00:01.000Z',
            resumeStatus: 'resuming',
            snapshotReady: true,
            pauseKind: 'human',
          },
        },
        metadata: {},
        resumedCount: 0,
        pausedAt: new Date('2026-08-05T12:00:01.000Z'),
        nextResumeAt: null,
      },
    ])

    const status = await getWorkflowExecutionStatus(input)

    expect(status?.status).toBe('paused')
    expect(status?.paused).toMatchObject({
      contextId: null,
      resumeAt: null,
      pauseKind: null,
      blockedOnBlockId: null,
      pausePointCount: 1,
    })
  })
})
