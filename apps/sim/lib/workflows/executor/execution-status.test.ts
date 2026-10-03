import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { asyncJobsMock, asyncJobsMockFns } from '@sim/testing/mocks/async-jobs.mock'
import { traceStoreMock, traceStoreMockFns } from '@sim/testing/mocks/trace-store.mock'
import { and } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/async-jobs', () => asyncJobsMock)

vi.mock('@/lib/logs/execution/trace-store', () => traceStoreMock)

vi.mock('@/lib/workflows/executor/paused-execution-metadata', () => ({
  getAutomaticResumeWaitingMetadata: vi.fn().mockReturnValue(null),
}))

import { getWorkflowExecutionStatus } from '@/lib/workflows/executor/execution-status'

const mockGetJob = asyncJobsMockFns.mockJobQueue.getJob
const mockMaterializeForDisplayWithBlockOutputs =
  traceStoreMockFns.mockMaterializeExecutionDataForDisplayWithBlockOutputs

const input = {
  workflowId: 'workflow-1',
  executionId: 'execution-1',
  includeOutput: false,
  selectedOutputs: [],
  workspaceId: 'workspace-1',
  /** No governing subject: field projection has its own suite next door. */
  viewerUserId: undefined,
}

describe('getWorkflowExecutionStatus queue projection', () => {
  beforeEach(() => {
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

describe('getWorkflowExecutionStatus settled resume attempts', () => {
  const resumeInput = { ...input, executionId: 'resume-run-1' }

  function parentLog(overrides: Record<string, unknown> = {}) {
    return {
      executionId: 'execution-1',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      status: 'completed',
      level: 'info',
      trigger: 'api',
      startedAt: new Date('2026-08-05T11:00:00.000Z'),
      endedAt: new Date('2026-08-05T12:00:05.000Z'),
      totalDurationMs: 3605000,
      executionData: { finalOutput: { answer: 42 } },
      costTotal: '0.5',
      ...overrides,
    }
  }

  function settledAttempt(overrides: Record<string, unknown> = {}) {
    return {
      id: 'resume-entry-1',
      parentExecutionId: 'execution-1',
      status: 'completed',
      queuedAt: new Date('2026-08-05T12:00:00.000Z'),
      claimedAt: new Date('2026-08-05T12:00:01.000Z'),
      completedAt: new Date('2026-08-05T12:00:05.000Z'),
      failureReason: null,
      ...overrides,
    }
  }

  /** The attempt has no log of its own; the parent run is read second. */
  function queueSettledResume(
    attempt: Record<string, unknown>,
    log: Record<string, unknown>,
    pausedRows: unknown[] = []
  ) {
    queueTableRows(schemaMock.workflowExecutionLogs, [])
    queueTableRows(schemaMock.resumeQueue, [attempt])
    queueTableRows(schemaMock.workflowExecutionLogs, [log])
    queueTableRows(schemaMock.resumeQueue, [])
    queueTableRows(schemaMock.pausedExecutions, pausedRows)
  }

  beforeEach(() => {
    resetDbChainMock()
    mockGetJob.mockResolvedValue(null)
    mockMaterializeForDisplayWithBlockOutputs.mockImplementation(async (executionData) => ({
      executionData,
      blockOutputs: new Map(),
    }))
  })

  it('projects a completed resume from the run it continued, under its own run ID', async () => {
    queueSettledResume(settledAttempt(), parentLog())

    const status = await getWorkflowExecutionStatus({ ...resumeInput, includeOutput: true })

    expect(status).toEqual({
      executionId: 'resume-run-1',
      workflowId: 'workflow-1',
      status: 'completed',
      trigger: 'api',
      level: 'info',
      startedAt: '2026-08-05T12:00:01.000Z',
      endedAt: '2026-08-05T12:00:05.000Z',
      totalDurationMs: 4000,
      paused: null,
      cost: { total: 0.5 },
      error: null,
      finalOutput: { answer: 42 },
      blockOutputs: null,
    })
    expect(mockMaterializeForDisplayWithBlockOutputs).toHaveBeenCalledWith(
      expect.anything(),
      { workspaceId: 'workspace-1', workflowId: 'workflow-1', executionId: 'execution-1' },
      []
    )
    expect(mockGetJob).toHaveBeenCalledWith('workflow-execution:resume-run-1')
  })

  it('reports the next pause when a completed resume paused the run again', async () => {
    queueSettledResume(settledAttempt(), parentLog({ status: 'paused', executionData: {} }), [
      {
        id: 'paused-1',
        status: 'partially_resumed',
        pausePoints: {
          'context-2': {
            contextId: 'context-2',
            blockId: 'block-2',
            pauseKind: 'human',
            resumeStatus: 'paused',
          },
        },
        metadata: {},
        resumedCount: 1,
        pausedAt: new Date('2026-08-05T12:00:04.000Z'),
        nextResumeAt: null,
      },
    ])

    const status = await getWorkflowExecutionStatus(resumeInput)

    expect(status).toMatchObject({
      executionId: 'resume-run-1',
      status: 'paused',
      endedAt: '2026-08-05T12:00:05.000Z',
      paused: { contextId: 'context-2', pausedExecutionId: 'paused-1', resumedCount: 1 },
    })
  })

  it('reports no end time while a later resume is still running the run', async () => {
    queueSettledResume(settledAttempt(), parentLog({ status: 'running', endedAt: null }))

    const status = await getWorkflowExecutionStatus(resumeInput)

    expect(status).toMatchObject({
      executionId: 'resume-run-1',
      status: 'running',
      startedAt: '2026-08-05T12:00:01.000Z',
      endedAt: null,
      totalDurationMs: null,
    })
  })

  it('reports a failed resume that left the run paused as failed with its reason', async () => {
    queueSettledResume(
      settledAttempt({ status: 'failed', failureReason: 'Resume execution cancelled' }),
      parentLog({ status: 'paused', executionData: {} })
    )

    const status = await getWorkflowExecutionStatus({ ...resumeInput, includeOutput: true })

    expect(status).toMatchObject({
      executionId: 'resume-run-1',
      status: 'failed',
      level: 'error',
      error: 'Resume execution cancelled',
      endedAt: '2026-08-05T12:00:05.000Z',
      paused: null,
      finalOutput: null,
      blockOutputs: null,
    })
  })

  it("prefers the run's own error when the failed resume failed the run", async () => {
    queueSettledResume(
      settledAttempt({ status: 'failed', failureReason: 'Unexpected error' }),
      parentLog({ status: 'failed', level: 'error', executionData: { error: 'Block 2 timed out' } })
    )

    const status = await getWorkflowExecutionStatus(resumeInput)

    expect(status).toMatchObject({ status: 'failed', error: 'Block 2 timed out' })
  })

  it('reports a resume that lost to cancellation as cancelled', async () => {
    queueSettledResume(
      settledAttempt({ status: 'failed', failureReason: 'Paused execution cancelled' }),
      parentLog({ status: 'cancelled', executionData: {} })
    )

    const status = await getWorkflowExecutionStatus(resumeInput)

    expect(status).toMatchObject({ status: 'cancelled', level: 'info', error: null })
  })
})
