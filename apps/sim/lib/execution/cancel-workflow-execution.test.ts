/**
 * @vitest-environment node
 */

import { databaseMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockMarkExecutionCancelled,
  mockClearExecutionCancellation,
  mockAbortManualExecution,
  mockBeginPausedCancellation,
  mockStagePausedCancellation,
  mockBlockQueuedResumesForCancellation,
  mockClearPausedCancellationIntent,
  mockCompletePausedCancellation,
  mockGetPausedCancellationStatus,
  mockGetActiveResumeCancellationTarget,
  mockRollbackActiveResumeCancellation,
  mockFinalizeExecutionStream,
  mockReadExecutionMetaState,
  mockWriteEvent,
  mockWriteTerminalEvent,
  mockCancelByExecution,
  mockGetJobQueue,
  mockReleaseExecutionSlot,
  mockCancelWorkflowGroupExecution,
  mockPublishWorkflowGroupCancellationEvent,
} = vi.hoisted(() => ({
  mockMarkExecutionCancelled: vi.fn(),
  mockClearExecutionCancellation: vi.fn(),
  mockAbortManualExecution: vi.fn(),
  mockBeginPausedCancellation: vi.fn(),
  mockStagePausedCancellation: vi.fn(),
  mockBlockQueuedResumesForCancellation: vi.fn(),
  mockClearPausedCancellationIntent: vi.fn(),
  mockCompletePausedCancellation: vi.fn(),
  mockGetPausedCancellationStatus: vi.fn(),
  mockGetActiveResumeCancellationTarget: vi.fn(),
  mockRollbackActiveResumeCancellation: vi.fn(),
  mockFinalizeExecutionStream: vi.fn(),
  mockReadExecutionMetaState: vi.fn(),
  mockWriteEvent: vi.fn(),
  mockWriteTerminalEvent: vi.fn(),
  mockCancelByExecution: vi.fn(),
  mockGetJobQueue: vi.fn(),
  mockReleaseExecutionSlot: vi.fn(),
  mockCancelWorkflowGroupExecution: vi.fn(),
  mockPublishWorkflowGroupCancellationEvent: vi.fn(),
}))

vi.mock('@/lib/core/async-jobs', () => ({
  getJobQueue: mockGetJobQueue,
}))

vi.mock('@/lib/billing/calculations/usage-reservation', () => ({
  releaseExecutionSlot: mockReleaseExecutionSlot,
}))

vi.mock('@/lib/execution/cancellation', () => ({
  markExecutionCancelled: (...args: unknown[]) => mockMarkExecutionCancelled(...args),
  clearExecutionCancellation: (...args: unknown[]) => mockClearExecutionCancellation(...args),
}))

vi.mock('@/lib/execution/manual-cancellation', () => ({
  abortManualExecution: (...args: unknown[]) => mockAbortManualExecution(...args),
}))

vi.mock('@/lib/workflows/executor/human-in-the-loop-manager', () => ({
  PauseResumeManager: {
    beginPausedCancellation: (...args: unknown[]) => mockBeginPausedCancellation(...args),
    stagePausedCancellation: (...args: unknown[]) => mockStagePausedCancellation(...args),
    blockQueuedResumesForCancellation: (...args: unknown[]) =>
      mockBlockQueuedResumesForCancellation(...args),
    clearPausedCancellationIntent: (...args: unknown[]) =>
      mockClearPausedCancellationIntent(...args),
    completePausedCancellation: (...args: unknown[]) => mockCompletePausedCancellation(...args),
    getPausedCancellationStatus: (...args: unknown[]) => mockGetPausedCancellationStatus(...args),
    getActiveResumeCancellationTarget: (...args: unknown[]) =>
      mockGetActiveResumeCancellationTarget(...args),
    rollbackActiveResumeCancellation: (...args: unknown[]) =>
      mockRollbackActiveResumeCancellation(...args),
  },
}))

vi.mock('@/lib/table/workflow-group-cancellation', () => ({
  cancelWorkflowGroupExecution: (...args: unknown[]) => mockCancelWorkflowGroupExecution(...args),
  publishWorkflowGroupCancellationEvent: (...args: unknown[]) =>
    mockPublishWorkflowGroupCancellationEvent(...args),
}))

vi.mock('@/lib/execution/event-buffer', () => ({
  finalizeExecutionStream: (...args: unknown[]) => mockFinalizeExecutionStream(...args),
  readExecutionMetaState: (...args: unknown[]) => mockReadExecutionMetaState(...args),
  createExecutionEventWriter: () => ({
    write: (...args: unknown[]) => mockWriteEvent(...args),
    writeTerminal: (...args: unknown[]) => mockWriteTerminalEvent(...args),
    close: vi.fn().mockResolvedValue(undefined),
  }),
}))

import { cancelWorkflowExecutionContract } from '@/lib/api/contracts/workflows'
import { OrchestrationError, statusForOrchestrationError } from '@/lib/core/orchestration/types'
import {
  type CancelWorkflowExecutionInput,
  cancelWorkflowExecution,
  WorkflowExecutionNotFoundError,
} from '@/lib/execution/cancel-workflow-execution'
import { WorkflowRunAlreadyTerminalError } from '@/lib/execution/workflow-run-already-terminal-error'

const INPUT: CancelWorkflowExecutionInput = {
  workflowId: 'wf-1',
  executionId: 'ex-1',
  workspaceId: 'workspace-1',
  attributedUserId: 'user-1',
}

async function cancelAsResponse(
  overrides: Partial<CancelWorkflowExecutionInput> = {}
): Promise<Response> {
  try {
    const result = await cancelWorkflowExecution({ ...INPUT, ...overrides })
    const body = cancelWorkflowExecutionContract.response.schema.parse(result)
    return Response.json(body)
  } catch (error) {
    if (error instanceof WorkflowExecutionNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 })
    }
    if (error instanceof OrchestrationError) {
      return Response.json(
        { error: error.message },
        { status: statusForOrchestrationError(error.code) }
      )
    }
    if (error instanceof Error) {
      return Response.json({ error: error.message }, { status: 500 })
    }
    throw error
  }
}

const POST = async (..._args: unknown[]) => cancelAsResponse()
const makeRequest = () => undefined
const makeParams = () => undefined

const ACTIVE_RESUME_TARGET = {
  resumeEntryId: 'resume-entry-1',
  pausedExecutionId: 'paused-1',
  parentExecutionId: 'ex-1',
  resumeExecutionId: 'resume-ex-1',
}

describe('cancelWorkflowExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    dbChainMockFns.limit.mockResolvedValue([
      {
        executionDeadlineAt: null,
        executionOrigin: null,
        status: 'running',
        workspaceId: 'workspace-1',
      },
    ])
    dbChainMockFns.returning.mockResolvedValue([{ status: 'cancelled' }])
    mockCancelByExecution.mockReset().mockResolvedValue(0)
    mockGetJobQueue.mockReset().mockResolvedValue({ cancelByExecution: mockCancelByExecution })
    mockReleaseExecutionSlot.mockReset().mockResolvedValue(undefined)
    mockCancelWorkflowGroupExecution.mockReset().mockResolvedValue({ kind: 'not_workflow_group' })
    mockPublishWorkflowGroupCancellationEvent.mockReset().mockResolvedValue(undefined)
    mockClearExecutionCancellation.mockReset().mockResolvedValue(undefined)
    mockMarkExecutionCancelled
      .mockReset()
      .mockResolvedValue({ durablyRecorded: false, reason: 'redis_unavailable' })
    mockAbortManualExecution.mockReset().mockReturnValue(false)
    mockBeginPausedCancellation.mockReset().mockResolvedValue(false)
    mockStagePausedCancellation.mockReset().mockResolvedValue({ kind: 'not_paused' })
    mockBlockQueuedResumesForCancellation.mockReset().mockResolvedValue(false)
    mockClearPausedCancellationIntent.mockReset().mockResolvedValue(undefined)
    mockCompletePausedCancellation.mockReset().mockResolvedValue(false)
    mockGetPausedCancellationStatus.mockReset().mockResolvedValue(null)
    mockGetActiveResumeCancellationTarget.mockReset().mockResolvedValue(null)
    mockRollbackActiveResumeCancellation.mockReset().mockResolvedValue(true)
    mockFinalizeExecutionStream.mockReset().mockResolvedValue(true)
    mockReadExecutionMetaState.mockReset().mockResolvedValue({ status: 'missing' })
    mockWriteEvent.mockReset().mockResolvedValue({ eventId: 1 })
    mockWriteTerminalEvent.mockReset().mockResolvedValue({ eventId: 1 })
  })

  it('returns success when cancellation was durably recorded', async () => {
    mockMarkExecutionCancelled.mockResolvedValue({
      durablyRecorded: true,
      reason: 'recorded',
    })

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      executionId: 'ex-1',
      redisAvailable: true,
      durablyRecorded: true,
      locallyAborted: false,
      pausedCancelled: false,
      reason: 'recorded',
    })
    expect(mockCancelByExecution).toHaveBeenCalledWith(
      {
        workflowId: 'wf-1',
        executionId: 'ex-1',
      },
      'standalone'
    )
    expect(mockMarkExecutionCancelled).toHaveBeenCalledWith('ex-1', {
      executionDeadlineAt: null,
    })
    expect(mockClearExecutionCancellation).not.toHaveBeenCalled()
  })

  it('atomically claims one workflow-group attempt before signalling it', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        executionDeadlineAt: null,
        executionOrigin: 'workflow_group',
        status: 'running',
        workspaceId: 'workspace-1',
      },
    ])
    mockCancelWorkflowGroupExecution.mockResolvedValue({
      kind: 'cancelled',
      tableId: 'table-1',
      rowId: 'row-1',
      groupId: 'group-1',
    })
    mockMarkExecutionCancelled.mockResolvedValue({
      durablyRecorded: true,
      reason: 'recorded',
    })

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      executionId: 'ex-1',
      redisAvailable: true,
      durablyRecorded: true,
      reason: 'recorded',
    })
    expect(mockCancelWorkflowGroupExecution).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      workflowId: 'wf-1',
      executionId: 'ex-1',
    })
    expect(mockCancelWorkflowGroupExecution.mock.invocationCallOrder[0]).toBeLessThan(
      mockMarkExecutionCancelled.mock.invocationCallOrder[0]
    )
    expect(mockMarkExecutionCancelled.mock.invocationCallOrder[0]).toBeLessThan(
      mockPublishWorkflowGroupCancellationEvent.mock.invocationCallOrder[0]
    )
    expect(mockCancelByExecution).not.toHaveBeenCalled()
    expect(mockStagePausedCancellation).toHaveBeenCalledWith('ex-1', 'wf-1')
    expect(mockClearPausedCancellationIntent).not.toHaveBeenCalled()
  })

  it('keeps a claimed group cancellation retryable when signalling fails', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        executionDeadlineAt: null,
        executionOrigin: 'workflow_group',
        status: 'running',
        workspaceId: 'workspace-1',
      },
    ])
    mockCancelWorkflowGroupExecution.mockResolvedValue({
      kind: 'cancelled',
      tableId: 'table-1',
      rowId: 'row-1',
      groupId: 'group-1',
    })
    mockMarkExecutionCancelled.mockResolvedValue({
      durablyRecorded: false,
      reason: 'redis_unavailable',
    })

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      durablyRecorded: false,
      reason: 'redis_unavailable',
    })
    expect(mockMarkExecutionCancelled).toHaveBeenCalledOnce()
    expect(mockCancelWorkflowGroupExecution).toHaveBeenCalledOnce()
    expect(mockPublishWorkflowGroupCancellationEvent).not.toHaveBeenCalled()
    expect(mockReleaseExecutionSlot).not.toHaveBeenCalled()
    expect(mockCancelByExecution).not.toHaveBeenCalled()
  })

  it('accepts an exact in-process group abort without cancelling its carrier', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        executionDeadlineAt: null,
        executionOrigin: 'workflow_group',
        status: 'running',
        workspaceId: 'workspace-1',
      },
    ])
    mockMarkExecutionCancelled.mockResolvedValue({
      durablyRecorded: false,
      reason: 'redis_unavailable',
    })
    mockAbortManualExecution.mockReturnValue(true)
    mockCancelWorkflowGroupExecution.mockResolvedValue({
      kind: 'cancelled',
      tableId: 'table-1',
      rowId: 'row-1',
      groupId: 'group-1',
    })
    mockCompletePausedCancellation.mockResolvedValue(true)

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      durablyRecorded: false,
      locallyAborted: true,
      reason: 'redis_unavailable',
    })
    expect(mockCancelWorkflowGroupExecution).toHaveBeenCalledOnce()
    expect(mockCancelByExecution).not.toHaveBeenCalled()
  })

  it('does not cancel a shared carrier when an idle workflow-group pause appears', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        executionDeadlineAt: null,
        executionOrigin: 'workflow_group',
        status: 'running',
        workspaceId: 'workspace-1',
      },
    ])
    mockMarkExecutionCancelled.mockResolvedValue({ durablyRecorded: true, reason: 'recorded' })
    mockCancelWorkflowGroupExecution.mockResolvedValue({
      kind: 'cancelled',
      tableId: 'table-1',
      rowId: 'row-1',
      groupId: 'group-1',
    })
    mockStagePausedCancellation
      .mockResolvedValueOnce({ kind: 'not_paused' })
      .mockResolvedValue({ kind: 'idle' })
    mockCompletePausedCancellation.mockResolvedValue(true)

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      pausedCancelled: true,
      reason: 'recorded',
    })
    expect(mockCancelByExecution).not.toHaveBeenCalled()
    expect(mockStagePausedCancellation.mock.invocationCallOrder[1]).toBeLessThan(
      mockWriteTerminalEvent.mock.invocationCallOrder[0]
    )
    expect(mockCompletePausedCancellation).toHaveBeenCalledWith('ex-1', 'wf-1')
  })

  it('leaves a late workflow-group pause retryable when event publication fails', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        executionDeadlineAt: null,
        executionOrigin: 'workflow_group',
        status: 'running',
        workspaceId: 'workspace-1',
      },
    ])
    mockMarkExecutionCancelled.mockResolvedValue({ durablyRecorded: true, reason: 'recorded' })
    mockCancelWorkflowGroupExecution.mockResolvedValue({
      kind: 'cancelled',
      tableId: 'table-1',
      rowId: 'row-1',
      groupId: 'group-1',
    })
    mockStagePausedCancellation
      .mockResolvedValueOnce({ kind: 'not_paused' })
      .mockResolvedValue({ kind: 'idle' })
    mockWriteTerminalEvent.mockRejectedValue(new Error('Redis unavailable'))

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      pausedCancelled: false,
      reason: 'paused_event_publish_failed',
    })
    expect(mockCancelWorkflowGroupExecution).toHaveBeenCalledOnce()
    expect(mockCancelWorkflowGroupExecution.mock.invocationCallOrder[0]).toBeLessThan(
      mockWriteTerminalEvent.mock.invocationCallOrder[0]
    )
    expect(mockCompletePausedCancellation).not.toHaveBeenCalled()
    expect(mockClearPausedCancellationIntent).not.toHaveBeenCalled()
  })

  it('cancels an active workflow-group resume without cancelling its shared carrier', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        executionDeadlineAt: null,
        executionOrigin: 'workflow_group',
        status: 'running',
        workspaceId: 'workspace-1',
      },
    ])
    mockStagePausedCancellation.mockResolvedValue({
      kind: 'active_resume',
      target: ACTIVE_RESUME_TARGET,
    })
    mockGetActiveResumeCancellationTarget.mockResolvedValue(ACTIVE_RESUME_TARGET)
    mockMarkExecutionCancelled.mockResolvedValue({
      durablyRecorded: false,
      reason: 'redis_unavailable',
    })
    mockCancelByExecution.mockResolvedValue(1)
    mockCancelWorkflowGroupExecution.mockResolvedValue({
      kind: 'cancelled',
      tableId: 'table-1',
      rowId: 'row-1',
      groupId: 'group-1',
    })
    mockCompletePausedCancellation.mockResolvedValue(true)

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      pausedCancelled: true,
      reason: 'recorded',
    })
    expect(mockCancelByExecution).toHaveBeenCalledOnce()
    expect(mockCancelByExecution).toHaveBeenCalledWith(
      { workflowId: 'wf-1', executionId: 'ex-1' },
      'resume'
    )
    expect(mockMarkExecutionCancelled).toHaveBeenCalledWith('resume-ex-1', {
      executionDeadlineAt: null,
    })
    expect(mockCancelWorkflowGroupExecution).toHaveBeenCalledOnce()
    expect(mockCancelWorkflowGroupExecution.mock.invocationCallOrder[0]).toBeLessThan(
      mockMarkExecutionCancelled.mock.invocationCallOrder[0]
    )
    expect(mockCompletePausedCancellation).toHaveBeenCalledWith('ex-1', 'wf-1')
    expect(mockWriteTerminalEvent.mock.invocationCallOrder[0]).toBeLessThan(
      mockCompletePausedCancellation.mock.invocationCallOrder[0]
    )
  })

  it('keeps a claimed active group resume retryable when no stop backend accepts it', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        executionDeadlineAt: null,
        executionOrigin: 'workflow_group',
        status: 'running',
        workspaceId: 'workspace-1',
      },
    ])
    mockStagePausedCancellation.mockResolvedValue({
      kind: 'active_resume',
      target: ACTIVE_RESUME_TARGET,
    })
    mockGetActiveResumeCancellationTarget.mockResolvedValue(ACTIVE_RESUME_TARGET)
    mockCancelWorkflowGroupExecution.mockResolvedValue({
      kind: 'cancelled',
      tableId: 'table-1',
      rowId: 'row-1',
      groupId: 'group-1',
    })

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      durablyRecorded: true,
      locallyAborted: false,
      pausedCancelled: false,
      reason: 'active_resume_signal_failed',
    })
    expect(mockMarkExecutionCancelled).toHaveBeenCalledWith('resume-ex-1', {
      executionDeadlineAt: null,
    })
    expect(mockCancelByExecution).toHaveBeenCalledWith(
      { workflowId: 'wf-1', executionId: 'ex-1' },
      'resume'
    )
    expect(mockCancelWorkflowGroupExecution.mock.invocationCallOrder[0]).toBeLessThan(
      mockMarkExecutionCancelled.mock.invocationCallOrder[0]
    )
    expect(mockRollbackActiveResumeCancellation).not.toHaveBeenCalled()
    expect(mockPublishWorkflowGroupCancellationEvent).not.toHaveBeenCalled()
  })

  it('rechecks for a pause after the group terminal claim waits on persistence', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        executionDeadlineAt: null,
        executionOrigin: 'workflow_group',
        status: 'running',
        workspaceId: 'workspace-1',
      },
    ])
    mockMarkExecutionCancelled.mockResolvedValue({ durablyRecorded: true, reason: 'recorded' })
    mockCancelWorkflowGroupExecution.mockResolvedValue({
      kind: 'cancelled',
      tableId: 'table-1',
      rowId: 'row-1',
      groupId: 'group-1',
    })
    mockStagePausedCancellation
      .mockResolvedValueOnce({ kind: 'not_paused' })
      .mockResolvedValue({ kind: 'idle' })
    mockCompletePausedCancellation.mockResolvedValue(true)

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      pausedCancelled: true,
      reason: 'recorded',
    })
    expect(mockCancelWorkflowGroupExecution.mock.invocationCallOrder[0]).toBeLessThan(
      mockStagePausedCancellation.mock.invocationCallOrder[1]
    )
    expect(mockStagePausedCancellation.mock.invocationCallOrder[1]).toBeLessThan(
      mockWriteTerminalEvent.mock.invocationCallOrder[0]
    )
    expect(mockWriteTerminalEvent.mock.invocationCallOrder[0]).toBeLessThan(
      mockCompletePausedCancellation.mock.invocationCallOrder[0]
    )
    expect(mockWriteTerminalEvent).toHaveBeenCalledOnce()
  })

  it('rechecks for a regular pause after the terminal claim waits on persistence', async () => {
    mockMarkExecutionCancelled.mockResolvedValue({ durablyRecorded: true, reason: 'recorded' })
    mockStagePausedCancellation
      .mockResolvedValueOnce({ kind: 'not_paused' })
      .mockResolvedValue({ kind: 'idle' })
    mockCompletePausedCancellation.mockResolvedValue(true)

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      pausedCancelled: true,
      reason: 'recorded',
    })
    expect(databaseMock.db.update.mock.invocationCallOrder[0]).toBeLessThan(
      mockStagePausedCancellation.mock.invocationCallOrder[1]
    )
    expect(mockStagePausedCancellation.mock.invocationCallOrder[1]).toBeLessThan(
      mockWriteTerminalEvent.mock.invocationCallOrder[0]
    )
    expect(mockWriteTerminalEvent.mock.invocationCallOrder[0]).toBeLessThan(
      mockCompletePausedCancellation.mock.invocationCallOrder[0]
    )
  })

  it('uses generic cancellation for a regular Table-trigger-block execution', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        executionDeadlineAt: null,
        executionOrigin: null,
        status: 'running',
        trigger: 'table',
        workspaceId: 'workspace-1',
      },
    ])
    mockMarkExecutionCancelled.mockResolvedValue({
      durablyRecorded: true,
      reason: 'recorded',
    })

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(200)
    expect(mockCancelWorkflowGroupExecution).not.toHaveBeenCalled()
    expect(mockMarkExecutionCancelled).toHaveBeenCalledWith('ex-1', {
      executionDeadlineAt: null,
    })
    expect(mockCancelByExecution).toHaveBeenCalledOnce()
  })

  it('returns 409 without generic cancellation when the exact group attempt is stale', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        executionDeadlineAt: null,
        executionOrigin: 'workflow_group',
        status: 'running',
        workspaceId: 'workspace-1',
      },
    ])
    mockMarkExecutionCancelled.mockResolvedValue({ durablyRecorded: true, reason: 'recorded' })
    mockCancelWorkflowGroupExecution.mockResolvedValue({
      kind: 'conflict',
      status: 'no_longer_active',
    })

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Workflow group execution cannot be cancelled while no_longer_active',
    })
    expect(mockMarkExecutionCancelled).not.toHaveBeenCalled()
    expect(mockPublishWorkflowGroupCancellationEvent).not.toHaveBeenCalled()
    expect(mockCancelByExecution).not.toHaveBeenCalled()
    expect(mockStagePausedCancellation).toHaveBeenCalledOnce()
    expect(mockClearExecutionCancellation).not.toHaveBeenCalled()
    expect(mockClearPausedCancellationIntent).not.toHaveBeenCalled()
  })

  it('terminalizes a durable workflow-group log after its table sidecar was deleted', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        executionDeadlineAt: null,
        executionOrigin: 'workflow_group',
        status: 'running',
        workspaceId: 'workspace-1',
      },
    ])
    mockMarkExecutionCancelled.mockResolvedValue({ durablyRecorded: true, reason: 'recorded' })
    mockCancelWorkflowGroupExecution.mockResolvedValue({ kind: 'cancelled_without_sidecar' })

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      executionId: 'ex-1',
      reason: 'recorded',
    })
    expect(mockMarkExecutionCancelled).toHaveBeenCalledOnce()
    expect(mockCancelByExecution).not.toHaveBeenCalled()
    expect(mockClearExecutionCancellation).not.toHaveBeenCalled()
    expect(mockClearPausedCancellationIntent).not.toHaveBeenCalled()
  })

  it('returns unsuccessful response when Redis is unavailable', async () => {
    mockMarkExecutionCancelled.mockResolvedValue({
      durablyRecorded: false,
      reason: 'redis_unavailable',
    })

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: false,
      executionId: 'ex-1',
      redisAvailable: false,
      durablyRecorded: false,
      locallyAborted: false,
      pausedCancelled: false,
      reason: 'redis_unavailable',
    })
  })

  it('returns unsuccessful response when Redis persistence fails', async () => {
    mockMarkExecutionCancelled.mockResolvedValue({
      durablyRecorded: false,
      reason: 'redis_write_failed',
    })

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: false,
      executionId: 'ex-1',
      redisAvailable: true,
      durablyRecorded: false,
      locallyAborted: false,
      pausedCancelled: false,
      reason: 'redis_write_failed',
    })
  })

  it('returns success when local fallback aborts execution without Redis durability', async () => {
    mockMarkExecutionCancelled.mockResolvedValue({
      durablyRecorded: false,
      reason: 'redis_unavailable',
    })
    mockAbortManualExecution.mockReturnValue(true)

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      executionId: 'ex-1',
      redisAvailable: false,
      durablyRecorded: false,
      locallyAborted: true,
      pausedCancelled: false,
      reason: 'redis_unavailable',
    })
  })

  it('returns success when the queue backend cancels the active job', async () => {
    mockMarkExecutionCancelled.mockResolvedValue({
      durablyRecorded: false,
      reason: 'redis_unavailable',
    })
    mockCancelByExecution.mockResolvedValue(1)

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      executionId: 'ex-1',
      durablyRecorded: false,
      locallyAborted: false,
      reason: 'queue_cancelled',
    })
    expect(mockClearExecutionCancellation).not.toHaveBeenCalled()
  })

  it('cancels a queued execution before its workflow log exists', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])
    mockCancelByExecution.mockResolvedValueOnce(1)
    mockMarkExecutionCancelled.mockResolvedValueOnce({
      durablyRecorded: true,
      reason: 'recorded',
    })

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      executionId: 'ex-1',
      redisAvailable: true,
      durablyRecorded: true,
      locallyAborted: false,
      pausedCancelled: false,
      reason: 'queue_cancelled',
    })
    expect(mockCancelByExecution).toHaveBeenCalledWith(
      {
        workflowId: 'wf-1',
        executionId: 'ex-1',
      },
      'standalone'
    )
    expect(mockMarkExecutionCancelled).toHaveBeenCalledWith('ex-1')
    expect(mockReleaseExecutionSlot).toHaveBeenCalledWith('ex-1')
    expect(mockClearExecutionCancellation).not.toHaveBeenCalled()
  })

  it('does not use an unscoped local abort before its workflow log exists', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Execution not found' })
    expect(mockAbortManualExecution).not.toHaveBeenCalled()
    expect(mockCancelByExecution).toHaveBeenCalledWith(
      {
        workflowId: 'wf-1',
        executionId: 'ex-1',
      },
      'standalone'
    )
    expect(mockMarkExecutionCancelled).not.toHaveBeenCalled()
    expect(mockReleaseExecutionSlot).not.toHaveBeenCalled()
    expect(mockClearExecutionCancellation).not.toHaveBeenCalled()
  })

  it('returns success when a paused HITL execution is cancelled directly in the database', async () => {
    mockStagePausedCancellation.mockResolvedValue({ kind: 'idle' })
    mockCompletePausedCancellation.mockResolvedValue(true)

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      executionId: 'ex-1',
      redisAvailable: true,
      durablyRecorded: true,
      locallyAborted: false,
      pausedCancelled: true,
      reason: 'recorded',
    })
    expect(mockMarkExecutionCancelled).not.toHaveBeenCalled()
    expect(mockWriteTerminalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'execution:cancelled',
        executionId: 'ex-1',
        workflowId: 'wf-1',
      }),
      'cancelled'
    )
    expect(mockFinalizeExecutionStream).not.toHaveBeenCalled()
  })

  it('claims the paused workflow-group sidecar before publishing and finalizing', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        executionDeadlineAt: null,
        executionOrigin: 'workflow_group',
        status: 'running',
        workspaceId: 'workspace-1',
      },
    ])
    mockCancelWorkflowGroupExecution.mockResolvedValue({
      kind: 'cancelled',
      tableId: 'table-1',
      rowId: 'row-1',
      groupId: 'group-1',
    })
    mockStagePausedCancellation.mockResolvedValue({ kind: 'idle' })
    mockCompletePausedCancellation.mockResolvedValue(true)

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      durablyRecorded: true,
      pausedCancelled: true,
      reason: 'recorded',
    })
    expect(mockStagePausedCancellation.mock.invocationCallOrder[0]).toBeLessThan(
      mockWriteTerminalEvent.mock.invocationCallOrder[0]
    )
    expect(mockCancelWorkflowGroupExecution.mock.invocationCallOrder[0]).toBeLessThan(
      mockWriteTerminalEvent.mock.invocationCallOrder[0]
    )
    expect(mockWriteTerminalEvent.mock.invocationCallOrder[0]).toBeLessThan(
      mockCompletePausedCancellation.mock.invocationCallOrder[0]
    )
    expect(mockMarkExecutionCancelled).not.toHaveBeenCalled()
    expect(mockCancelByExecution).not.toHaveBeenCalled()
    expect(mockWriteTerminalEvent).toHaveBeenCalledOnce()
    expect(mockCompletePausedCancellation).toHaveBeenCalledWith('ex-1', 'wf-1')
  })

  it('keeps a paused workflow-group cancellation reserved when event publication fails', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        executionDeadlineAt: null,
        executionOrigin: 'workflow_group',
        status: 'running',
        workspaceId: 'workspace-1',
      },
    ])
    mockStagePausedCancellation.mockResolvedValue({ kind: 'idle' })
    mockCancelWorkflowGroupExecution.mockResolvedValue({
      kind: 'cancelled',
      tableId: 'table-1',
      rowId: 'row-1',
      groupId: 'group-1',
    })
    mockWriteTerminalEvent.mockRejectedValue(new Error('Redis unavailable'))

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      pausedCancelled: false,
      reason: 'paused_event_publish_failed',
    })
    expect(mockCompletePausedCancellation).not.toHaveBeenCalled()
    expect(mockCancelWorkflowGroupExecution).toHaveBeenCalledOnce()
    expect(mockClearPausedCancellationIntent).not.toHaveBeenCalled()
    expect(mockCancelByExecution).not.toHaveBeenCalled()
  })

  it('publishes paused cancellation event even when Redis cancellation is recorded', async () => {
    mockStagePausedCancellation.mockResolvedValue({ kind: 'idle' })
    mockCompletePausedCancellation.mockResolvedValue(true)

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      executionId: 'ex-1',
      durablyRecorded: true,
      pausedCancelled: true,
    })
    expect(mockMarkExecutionCancelled).not.toHaveBeenCalled()
    expect(mockWriteTerminalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'execution:cancelled',
        executionId: 'ex-1',
        workflowId: 'wf-1',
      }),
      'cancelled'
    )
    expect(mockFinalizeExecutionStream).not.toHaveBeenCalled()
  })

  it('does not confirm paused cancellation when terminal event publication fails', async () => {
    mockStagePausedCancellation.mockResolvedValue({ kind: 'idle' })
    mockCompletePausedCancellation.mockResolvedValue(true)
    mockWriteTerminalEvent.mockRejectedValue(new Error('Redis unavailable'))

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: false,
      executionId: 'ex-1',
      redisAvailable: false,
      durablyRecorded: true,
      locallyAborted: false,
      pausedCancelled: false,
      reason: 'paused_event_publish_failed',
    })
    expect(mockMarkExecutionCancelled).not.toHaveBeenCalled()
    expect(mockCompletePausedCancellation).not.toHaveBeenCalled()
    expect(mockWriteTerminalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'execution:cancelled',
        executionId: 'ex-1',
        workflowId: 'wf-1',
      }),
      'cancelled'
    )
    expect(mockFinalizeExecutionStream).not.toHaveBeenCalled()
  })

  it('finishes reconciliation when the pause row is already cancelled', async () => {
    mockStagePausedCancellation.mockResolvedValue({ kind: 'idle' })
    mockCompletePausedCancellation.mockResolvedValue(true)

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      pausedCancelled: true,
      reason: 'recorded',
    })
    expect(mockMarkExecutionCancelled).not.toHaveBeenCalled()
    expect(mockWriteTerminalEvent.mock.invocationCallOrder[0]).toBeLessThan(
      mockCompletePausedCancellation.mock.invocationCallOrder[0]
    )
  })

  it('stops before lookup when cancellation is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    const response = await cancelAsResponse({
      abortSignal: controller.signal,
    })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Request aborted before workflow run cancellation could be applied.',
    })
    expect(databaseMock.db.select).not.toHaveBeenCalled()
    expect(mockMarkExecutionCancelled).not.toHaveBeenCalled()
  })

  it('stops before mutation when cancellation is aborted during execution lookup', async () => {
    const controller = new AbortController()
    dbChainMockFns.limit.mockImplementationOnce(async () => {
      controller.abort()
      return [
        {
          executionDeadlineAt: null,
          executionOrigin: null,
          status: 'running',
          workspaceId: 'workspace-1',
        },
      ]
    })

    const response = await cancelAsResponse({
      abortSignal: controller.signal,
    })

    expect(response.status).toBe(409)
    expect(mockMarkExecutionCancelled).not.toHaveBeenCalled()
    expect(mockAbortManualExecution).not.toHaveBeenCalled()
    expect(mockCancelByExecution).not.toHaveBeenCalled()
  })

  it('rolls back pause staging when cancellation is aborted during staging', async () => {
    const controller = new AbortController()
    mockStagePausedCancellation.mockImplementationOnce(async () => {
      controller.abort()
      return { kind: 'idle' }
    })

    const response = await cancelAsResponse({
      abortSignal: controller.signal,
    })

    expect(response.status).toBe(409)
    expect(mockClearPausedCancellationIntent).toHaveBeenCalledWith('ex-1', 'wf-1')
    expect(mockMarkExecutionCancelled).not.toHaveBeenCalled()
    expect(mockAbortManualExecution).not.toHaveBeenCalled()
    expect(mockCancelByExecution).not.toHaveBeenCalled()
  })

  it('rolls back an active resume staged while cancellation is aborted', async () => {
    const controller = new AbortController()
    mockStagePausedCancellation.mockImplementationOnce(async () => {
      controller.abort()
      return { kind: 'active_resume', target: ACTIVE_RESUME_TARGET }
    })

    const response = await cancelAsResponse({
      abortSignal: controller.signal,
    })

    expect(response.status).toBe(409)
    expect(mockRollbackActiveResumeCancellation).toHaveBeenCalledWith(
      'ex-1',
      'wf-1',
      'resume-entry-1'
    )
    expect(mockMarkExecutionCancelled).not.toHaveBeenCalled()
  })

  it('rolls back pause staging for an already-cancelled execution when cancellation is aborted', async () => {
    const controller = new AbortController()
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        executionDeadlineAt: null,
        executionOrigin: null,
        status: 'cancelled',
        workspaceId: 'workspace-1',
      },
    ])
    mockStagePausedCancellation.mockImplementationOnce(async () => {
      controller.abort()
      return { kind: 'idle' }
    })

    const response = await cancelAsResponse({
      abortSignal: controller.signal,
    })

    expect(response.status).toBe(409)
    expect(mockClearPausedCancellationIntent).toHaveBeenCalledWith('ex-1', 'wf-1')
    expect(mockWriteTerminalEvent).not.toHaveBeenCalled()
    expect(mockCompletePausedCancellation).not.toHaveBeenCalled()
    expect(mockReleaseExecutionSlot).not.toHaveBeenCalled()
  })

  it('finishes cancellation when an aborted active-resume stage cannot be rolled back', async () => {
    const controller = new AbortController()
    mockStagePausedCancellation.mockImplementationOnce(async () => {
      controller.abort()
      return { kind: 'active_resume', target: ACTIVE_RESUME_TARGET }
    })
    mockRollbackActiveResumeCancellation.mockResolvedValueOnce(false)
    mockMarkExecutionCancelled.mockResolvedValue({ durablyRecorded: true, reason: 'recorded' })
    mockCompletePausedCancellation.mockResolvedValue(true)

    const response = await cancelAsResponse({
      abortSignal: controller.signal,
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ success: true, pausedCancelled: true })
    expect(mockRollbackActiveResumeCancellation).toHaveBeenCalledWith(
      'ex-1',
      'wf-1',
      'resume-entry-1'
    )
    expect(mockMarkExecutionCancelled).toHaveBeenCalledWith('resume-ex-1', {
      executionDeadlineAt: null,
    })
  })

  it('returns 404 when the execution does not belong to the workflow', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(404)
    expect(mockMarkExecutionCancelled).not.toHaveBeenCalled()
    expect(mockCancelByExecution).toHaveBeenCalledWith(
      {
        workflowId: 'wf-1',
        executionId: 'ex-1',
      },
      'standalone'
    )
  })

  it('treats an already-cancelled execution as an idempotent success', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { executionDeadlineAt: null, status: 'cancelled', workspaceId: 'workspace-1' },
    ])

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      durablyRecorded: false,
      reason: 'already_cancelled',
    })
    expect(mockCancelByExecution).not.toHaveBeenCalled()
    expect(mockReleaseExecutionSlot).toHaveBeenCalledWith('ex-1')
  })

  it('reconciles the exact sidecar when a workflow-group log is already cancelled', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        executionDeadlineAt: null,
        executionOrigin: 'workflow_group',
        status: 'cancelled',
        workspaceId: 'workspace-1',
      },
    ])
    mockCancelWorkflowGroupExecution.mockResolvedValue({
      kind: 'already_cancelled',
      tableId: 'table-1',
      rowId: 'row-1',
      groupId: 'group-1',
    })
    mockMarkExecutionCancelled.mockResolvedValue({ durablyRecorded: true, reason: 'recorded' })

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      reason: 'already_cancelled',
    })
    expect(mockCancelWorkflowGroupExecution).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      workflowId: 'wf-1',
      executionId: 'ex-1',
    })
    expect(mockMarkExecutionCancelled).toHaveBeenCalledWith('ex-1', {
      executionDeadlineAt: null,
    })
    expect(mockPublishWorkflowGroupCancellationEvent).toHaveBeenCalledOnce()
    expect(mockCancelByExecution).not.toHaveBeenCalled()
  })

  it('finishes workflow-group reconciliation when abort arrives during its durable commit', async () => {
    const controller = new AbortController()
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        executionDeadlineAt: null,
        executionOrigin: 'workflow_group',
        status: 'cancelled',
        workspaceId: 'workspace-1',
      },
    ])
    mockCancelWorkflowGroupExecution.mockImplementationOnce(async () => {
      controller.abort()
      return {
        kind: 'already_cancelled',
        tableId: 'table-1',
        rowId: 'row-1',
        groupId: 'group-1',
      }
    })
    mockStagePausedCancellation.mockResolvedValue({ kind: 'idle' })
    mockCompletePausedCancellation.mockResolvedValue(true)

    const response = await cancelAsResponse({
      abortSignal: controller.signal,
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ success: true, pausedCancelled: true })
    expect(mockClearPausedCancellationIntent).not.toHaveBeenCalled()
    expect(mockPublishWorkflowGroupCancellationEvent).toHaveBeenCalledOnce()
    expect(mockCompletePausedCancellation).toHaveBeenCalledWith('ex-1', 'wf-1')
  })

  it('does not finalize an already-cancelled group retry until exact stop is accepted', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        executionDeadlineAt: null,
        executionOrigin: 'workflow_group',
        status: 'cancelled',
        workspaceId: 'workspace-1',
      },
    ])
    mockCancelWorkflowGroupExecution.mockResolvedValue({
      kind: 'already_cancelled',
      tableId: 'table-1',
      rowId: 'row-1',
      groupId: 'group-1',
    })

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      redisAvailable: false,
      reason: 'redis_unavailable',
    })
    expect(mockPublishWorkflowGroupCancellationEvent).not.toHaveBeenCalled()
    expect(mockWriteTerminalEvent).not.toHaveBeenCalled()
    expect(mockReleaseExecutionSlot).not.toHaveBeenCalled()
  })

  it('repairs a stranded active resume when the group log is already cancelled', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        executionDeadlineAt: null,
        executionOrigin: 'workflow_group',
        status: 'cancelled',
        workspaceId: 'workspace-1',
      },
    ])
    mockStagePausedCancellation.mockResolvedValue({
      kind: 'active_resume',
      target: ACTIVE_RESUME_TARGET,
    })
    mockGetActiveResumeCancellationTarget.mockResolvedValue(ACTIVE_RESUME_TARGET)
    mockAbortManualExecution.mockReturnValue(true)
    mockCancelByExecution.mockResolvedValue(1)
    mockCompletePausedCancellation.mockResolvedValue(true)
    mockCancelWorkflowGroupExecution.mockResolvedValue({
      kind: 'already_cancelled',
      tableId: 'table-1',
      rowId: 'row-1',
      groupId: 'group-1',
    })

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      locallyAborted: true,
      pausedCancelled: true,
      reason: 'already_cancelled',
    })
    expect(mockCancelByExecution).toHaveBeenCalledWith(
      { workflowId: 'wf-1', executionId: 'ex-1' },
      'resume'
    )
    expect(mockAbortManualExecution).toHaveBeenCalledWith('resume-ex-1')
    expect(mockCompletePausedCancellation).toHaveBeenCalledWith('ex-1', 'wf-1')
    expect(mockWriteTerminalEvent).toHaveBeenCalledOnce()
    expect(mockWriteTerminalEvent.mock.invocationCallOrder[0]).toBeLessThan(
      mockCompletePausedCancellation.mock.invocationCallOrder[0]
    )
  })

  it('repairs a stranded active resume when a regular workflow log is already cancelled', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        executionDeadlineAt: null,
        executionOrigin: null,
        status: 'cancelled',
        workspaceId: 'workspace-1',
      },
    ])
    mockStagePausedCancellation.mockResolvedValue({
      kind: 'active_resume',
      target: ACTIVE_RESUME_TARGET,
    })
    mockGetActiveResumeCancellationTarget.mockResolvedValue(ACTIVE_RESUME_TARGET)
    mockAbortManualExecution.mockReturnValue(true)
    mockCancelByExecution.mockResolvedValue(1)
    mockCompletePausedCancellation.mockResolvedValue(true)

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      locallyAborted: true,
      pausedCancelled: true,
      reason: 'already_cancelled',
    })
    expect(mockCancelByExecution).toHaveBeenCalledWith(
      { workflowId: 'wf-1', executionId: 'ex-1' },
      'resume'
    )
    expect(mockWriteTerminalEvent.mock.invocationCallOrder[0]).toBeLessThan(
      mockCompletePausedCancellation.mock.invocationCallOrder[0]
    )
    expect(mockCancelWorkflowGroupExecution).not.toHaveBeenCalled()
  })

  it('keeps an already-cancelled active resume retryable when publication fails', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        executionDeadlineAt: null,
        executionOrigin: null,
        status: 'cancelled',
        workspaceId: 'workspace-1',
      },
    ])
    mockStagePausedCancellation.mockResolvedValue({
      kind: 'active_resume',
      target: ACTIVE_RESUME_TARGET,
    })
    mockGetActiveResumeCancellationTarget.mockResolvedValue(ACTIVE_RESUME_TARGET)
    mockMarkExecutionCancelled.mockResolvedValue({ durablyRecorded: true, reason: 'recorded' })
    mockWriteTerminalEvent.mockRejectedValue(new Error('Redis unavailable'))

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      pausedCancelled: false,
      reason: 'paused_event_publish_failed',
    })
    expect(mockCompletePausedCancellation).not.toHaveBeenCalled()
  })

  it('fails closed when an already-cancelled group sidecar cannot be reconciled', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        executionDeadlineAt: null,
        executionOrigin: 'workflow_group',
        status: 'cancelled',
        workspaceId: 'workspace-1',
      },
    ])
    mockCancelWorkflowGroupExecution.mockResolvedValue({
      kind: 'conflict',
      status: 'completed',
    })

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Workflow group execution cannot be reconciled while completed',
    })
  })

  it('reports a reconciliation failure for an already-cancelled group sidecar', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        executionDeadlineAt: null,
        executionOrigin: 'workflow_group',
        status: 'cancelled',
        workspaceId: 'workspace-1',
      },
    ])
    mockCancelWorkflowGroupExecution.mockRejectedValue(new Error('database unavailable'))

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'database unavailable' })
  })

  it.each(['completed', 'failed'] as const)(
    'raises a typed conflict when a standalone execution is already %s',
    async (executionStatus) => {
      dbChainMockFns.limit.mockResolvedValueOnce([
        { status: executionStatus, workspaceId: 'workspace-1' },
      ])

      const error = await cancelWorkflowExecution(INPUT).catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(WorkflowRunAlreadyTerminalError)
      expect(error).toEqual(
        expect.objectContaining({
          code: 'conflict',
          executionId: 'ex-1',
          executionStatus,
          redisAvailable: true,
          locallyAborted: false,
        })
      )
      expect(mockMarkExecutionCancelled).not.toHaveBeenCalled()
      expect(mockCancelByExecution).not.toHaveBeenCalled()
    }
  )

  it('keeps workflow-group terminal conflicts strict', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        executionOrigin: 'workflow_group',
        status: 'completed',
        workspaceId: 'workspace-1',
      },
    ])

    await expect(cancelWorkflowExecution(INPUT)).rejects.toMatchObject({
      name: 'OrchestrationError',
      code: 'conflict',
      message: 'Execution cannot be cancelled while completed',
    })
    expect(mockMarkExecutionCancelled).not.toHaveBeenCalled()
    expect(mockCancelByExecution).not.toHaveBeenCalled()
  })

  it('returns 409 when completion wins the terminal database race', async () => {
    mockMarkExecutionCancelled.mockResolvedValue({ durablyRecorded: true, reason: 'recorded' })
    const returning = vi.fn().mockResolvedValue([])
    const where = vi.fn(() => ({ returning }))
    databaseMock.db.update.mockReturnValueOnce({ set: vi.fn(() => ({ where })) })
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        { executionDeadlineAt: null, status: 'running', workspaceId: 'workspace-1' },
      ])
      .mockResolvedValueOnce([{ status: 'completed' }])

    const error = await cancelWorkflowExecution(INPUT).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(WorkflowRunAlreadyTerminalError)
    expect(error).toEqual(
      expect.objectContaining({
        code: 'conflict',
        executionId: 'ex-1',
        executionStatus: 'completed',
        redisAvailable: true,
        locallyAborted: false,
      })
    )
    expect(returning).toHaveBeenCalledOnce()
    expect(mockClearExecutionCancellation).toHaveBeenCalledWith('ex-1')
    expect(mockWriteTerminalEvent).not.toHaveBeenCalled()
    expect(mockReleaseExecutionSlot).not.toHaveBeenCalled()
  })

  it('rolls back paused cancellation intent when resume completion wins the log claim', async () => {
    mockStagePausedCancellation.mockResolvedValue({ kind: 'idle' })
    const returning = vi.fn().mockResolvedValue([])
    const where = vi.fn(() => ({ returning }))
    databaseMock.db.update.mockReturnValueOnce({ set: vi.fn(() => ({ where })) })
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        { executionDeadlineAt: null, status: 'running', workspaceId: 'workspace-1' },
      ])
      .mockResolvedValueOnce([{ status: 'completed' }])

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Execution cannot be cancelled while completed',
    })
    expect(mockWriteTerminalEvent).not.toHaveBeenCalled()
    expect(mockCompletePausedCancellation).not.toHaveBeenCalled()
    expect(mockClearPausedCancellationIntent).toHaveBeenCalledWith('ex-1', 'wf-1')
  })

  it('treats a concurrent cancellation as an idempotent success', async () => {
    mockMarkExecutionCancelled.mockResolvedValue({ durablyRecorded: true, reason: 'recorded' })
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        { executionDeadlineAt: null, status: 'running', workspaceId: 'workspace-1' },
      ])
      .mockResolvedValueOnce([{ status: 'cancelled' }])
    dbChainMockFns.returning.mockResolvedValueOnce([])

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ success: true, reason: 'recorded' })
    expect(mockClearExecutionCancellation).not.toHaveBeenCalled()
    expect(mockWriteTerminalEvent).toHaveBeenCalledTimes(1)
    expect(mockReleaseExecutionSlot).toHaveBeenCalledWith('ex-1')
  })

  it('updates execution log status in DB when durably recorded', async () => {
    const mockWhere = vi.fn().mockResolvedValue(undefined)
    const mockSet = vi.fn(() => ({ where: mockWhere }))
    databaseMock.db.update.mockReturnValueOnce({ set: mockSet })
    mockMarkExecutionCancelled.mockResolvedValue({
      durablyRecorded: true,
      reason: 'recorded',
    })

    await POST(makeRequest(), makeParams())

    expect(databaseMock.db.update).toHaveBeenCalled()
    expect(mockSet).toHaveBeenCalledWith({
      status: 'cancelled',
      endedAt: expect.any(Date),
      totalDurationMs: expect.anything(),
      executionDeadlineAt: null,
    })
  })

  it('updates execution log status in DB when locally aborted', async () => {
    const mockWhere = vi.fn().mockResolvedValue(undefined)
    const mockSet = vi.fn(() => ({ where: mockWhere }))
    databaseMock.db.update.mockReturnValueOnce({ set: mockSet })
    mockMarkExecutionCancelled.mockResolvedValue({
      durablyRecorded: false,
      reason: 'redis_unavailable',
    })
    mockAbortManualExecution.mockReturnValue(true)

    await POST(makeRequest(), makeParams())

    expect(databaseMock.db.update).toHaveBeenCalled()
    expect(mockSet).toHaveBeenCalledWith({
      status: 'cancelled',
      endedAt: expect.any(Date),
      totalDurationMs: expect.anything(),
      executionDeadlineAt: null,
    })
  })

  it('claims the execution log before finalizing a paused cancellation', async () => {
    mockStagePausedCancellation.mockResolvedValue({ kind: 'idle' })

    await POST(makeRequest(), makeParams())

    expect(databaseMock.db.update).toHaveBeenCalled()
  })

  it('does not confirm cancellation until the terminal database update succeeds', async () => {
    mockMarkExecutionCancelled.mockResolvedValue({
      durablyRecorded: true,
      reason: 'recorded',
    })
    databaseMock.db.update.mockReturnValueOnce({
      set: vi.fn(() => ({
        where: vi.fn(() => {
          throw new Error('DB connection failed')
        }),
      })),
    })

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toMatchObject({
      success: false,
      reason: 'cancellation_not_finalized',
    })
    expect(mockClearExecutionCancellation).not.toHaveBeenCalled()
  })
})
