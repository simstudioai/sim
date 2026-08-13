/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAbortManualExecution,
  mockBeginPausedCancellation,
  mockBlockQueuedResumes,
  mockCancelWorkflowGroupExecution,
  mockCaptureServerEvent,
  mockClearPausedCancellationIntent,
  mockCompletePausedCancellation,
  mockGetJobQueue,
  mockGetPausedCancellationStatus,
  mockMarkExecutionCancelled,
  mockPublishWorkflowGroupCancellationEvent,
  mockReleaseExecutionSlot,
  mockUpdateSet,
  mockResolveWorkflowExecutionOwnership,
} = vi.hoisted(() => ({
  mockAbortManualExecution: vi.fn(),
  mockBeginPausedCancellation: vi.fn(),
  mockBlockQueuedResumes: vi.fn(),
  mockCancelWorkflowGroupExecution: vi.fn(),
  mockCaptureServerEvent: vi.fn(),
  mockClearPausedCancellationIntent: vi.fn(),
  mockCompletePausedCancellation: vi.fn(),
  mockGetJobQueue: vi.fn(),
  mockGetPausedCancellationStatus: vi.fn(),
  mockMarkExecutionCancelled: vi.fn(),
  mockPublishWorkflowGroupCancellationEvent: vi.fn(),
  mockReleaseExecutionSlot: vi.fn(),
  mockUpdateSet: vi.fn(),
  mockResolveWorkflowExecutionOwnership: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    update: () => ({
      set: (values: unknown) => {
        mockUpdateSet(values)
        return { where: () => Promise.resolve(undefined) }
      },
    }),
  },
}))

vi.mock('@/lib/billing/calculations/usage-reservation', () => ({
  releaseExecutionSlot: mockReleaseExecutionSlot,
}))

vi.mock('@/lib/table/workflow-group-cancellation', () => ({
  cancelWorkflowGroupExecution: mockCancelWorkflowGroupExecution,
  publishWorkflowGroupCancellationEvent: mockPublishWorkflowGroupCancellationEvent,
}))

vi.mock('@/lib/execution/cancellation', () => ({
  markExecutionCancelled: mockMarkExecutionCancelled,
}))

vi.mock('@/lib/execution/manual-cancellation', () => ({
  abortManualExecution: mockAbortManualExecution,
}))

vi.mock('@/lib/execution/event-buffer', () => ({
  createExecutionEventWriter: () => ({
    writeTerminal: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  }),
  readExecutionMetaState: vi.fn().mockResolvedValue({ status: 'missing' }),
}))

vi.mock('@/lib/core/async-jobs', () => ({
  getJobQueue: mockGetJobQueue,
}))

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: mockCaptureServerEvent,
}))

vi.mock('@/lib/workflows/executor/execution-job-ids', () => ({
  WORKFLOW_EXECUTION_JOB_ID_PREFIX: 'workflow-execution:',
}))

vi.mock('@/lib/workflows/executor/execution-queries', () => ({
  resolveWorkflowExecutionOwnership: mockResolveWorkflowExecutionOwnership,
}))

vi.mock('@/lib/workflows/executor/human-in-the-loop-manager', () => ({
  PauseResumeManager: {
    beginPausedCancellation: mockBeginPausedCancellation,
    getPausedCancellationStatus: mockGetPausedCancellationStatus,
    blockQueuedResumesForCancellation: mockBlockQueuedResumes,
    clearPausedCancellationIntent: mockClearPausedCancellationIntent,
    completePausedCancellation: mockCompletePausedCancellation,
  },
}))

import { cancelWorkflowExecution } from '@/lib/execution/cancel-workflow-execution'

const INPUT = {
  executionId: 'execution-1',
  workflowId: 'workflow-1',
  userId: 'user-1',
  workspaceId: 'workspace-1',
}

describe('cancelWorkflowExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveWorkflowExecutionOwnership.mockResolvedValue({
      belongsToWorkflow: true,
      workflowGroupWorkspaceId: null,
    })
    mockBeginPausedCancellation.mockResolvedValue(false)
    mockGetPausedCancellationStatus.mockResolvedValue(null)
    mockMarkExecutionCancelled.mockResolvedValue({ durablyRecorded: true, reason: 'recorded' })
    mockAbortManualExecution.mockReturnValue(false)
    mockBlockQueuedResumes.mockResolvedValue(undefined)
    mockClearPausedCancellationIntent.mockResolvedValue(undefined)
    mockCompletePausedCancellation.mockResolvedValue(true)
    mockReleaseExecutionSlot.mockResolvedValue(undefined)
    mockPublishWorkflowGroupCancellationEvent.mockResolvedValue(undefined)
    mockGetJobQueue.mockResolvedValue({
      getJob: vi.fn().mockResolvedValue(null),
      cancelJob: vi.fn(),
    })
  })

  it('releases the plan concurrency reservation after a successful cancellation', async () => {
    const result = await cancelWorkflowExecution(INPUT)

    expect(result.success).toBe(true)
    expect(mockReleaseExecutionSlot).toHaveBeenCalledWith('execution-1')
  })

  it('keeps the reservation held when nothing could be cancelled', async () => {
    mockMarkExecutionCancelled.mockResolvedValue({
      durablyRecorded: false,
      reason: 'redis_unavailable',
    })

    const result = await cancelWorkflowExecution(INPUT)

    expect(result.success).toBe(false)
    expect(mockReleaseExecutionSlot).not.toHaveBeenCalled()
  })

  it('cancels and publishes the table cell sidecar of a workflow-group execution', async () => {
    mockResolveWorkflowExecutionOwnership.mockResolvedValue({
      belongsToWorkflow: true,
      workflowGroupWorkspaceId: 'workspace-1',
    })
    const cancelled = {
      kind: 'cancelled' as const,
      tableId: 'table-1',
      rowId: 'row-1',
      groupId: 'group-1',
    }
    mockCancelWorkflowGroupExecution.mockResolvedValue(cancelled)

    const result = await cancelWorkflowExecution(INPUT)

    expect(result.success).toBe(true)
    expect(mockCancelWorkflowGroupExecution).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
    })
    expect(mockPublishWorkflowGroupCancellationEvent).toHaveBeenCalledWith(cancelled, 'execution-1')
    expect(mockUpdateSet).not.toHaveBeenCalled()
    expect(mockReleaseExecutionSlot).toHaveBeenCalledWith('execution-1')
  })

  it.each([
    [{ kind: 'conflict' as const, status: 'completed' }, 'cannot be cancelled while completed'],
    [{ kind: 'not_workflow_group' as const }, 'no longer the active table execution'],
  ])(
    'releases the reservation before reporting a refused workflow-group cell claim as a conflict',
    async (outcome, message) => {
      mockResolveWorkflowExecutionOwnership.mockResolvedValue({
        belongsToWorkflow: true,
        workflowGroupWorkspaceId: 'workspace-1',
      })
      mockCancelWorkflowGroupExecution.mockResolvedValue(outcome)

      await expect(cancelWorkflowExecution(INPUT)).rejects.toMatchObject({
        code: 'conflict',
        message: expect.stringContaining(message),
      })
      expect(mockPublishWorkflowGroupCancellationEvent).not.toHaveBeenCalled()
      expect(mockReleaseExecutionSlot).toHaveBeenCalledWith('execution-1')
    }
  )

  it.each([
    [{ kind: 'conflict' as const, status: 'completed' }],
    [{ kind: 'not_workflow_group' as const }],
  ])(
    'keeps the reservation held when a refused claim follows a paused cancellation',
    async (outcome) => {
      mockResolveWorkflowExecutionOwnership.mockResolvedValue({
        belongsToWorkflow: true,
        workflowGroupWorkspaceId: 'workspace-1',
      })
      mockBeginPausedCancellation.mockResolvedValue(true)
      mockCancelWorkflowGroupExecution.mockResolvedValue(outcome)

      await expect(cancelWorkflowExecution(INPUT)).rejects.toMatchObject({ code: 'conflict' })
      expect(mockReleaseExecutionSlot).not.toHaveBeenCalled()
    }
  )

  it.each([
    [{ kind: 'conflict' as const, status: 'completed' }],
    [{ kind: 'not_workflow_group' as const }],
  ])(
    'keeps the reservation held when a refused claim follows a failed cancellation',
    async (outcome) => {
      mockResolveWorkflowExecutionOwnership.mockResolvedValue({
        belongsToWorkflow: true,
        workflowGroupWorkspaceId: 'workspace-1',
      })
      mockMarkExecutionCancelled.mockResolvedValue({
        durablyRecorded: false,
        reason: 'redis_unavailable',
      })
      mockCancelWorkflowGroupExecution.mockResolvedValue(outcome)

      await expect(cancelWorkflowExecution(INPUT)).rejects.toMatchObject({ code: 'conflict' })
      expect(mockReleaseExecutionSlot).not.toHaveBeenCalled()
    }
  )

  it('releases the reservation and rethrows when the workflow-group cancel fails unexpectedly', async () => {
    mockResolveWorkflowExecutionOwnership.mockResolvedValue({
      belongsToWorkflow: true,
      workflowGroupWorkspaceId: 'workspace-1',
    })
    const failure = new Error('Workflow-group cancellation lost its locked workflow-log claim')
    mockCancelWorkflowGroupExecution.mockRejectedValue(failure)

    await expect(cancelWorkflowExecution(INPUT)).rejects.toBe(failure)
    expect(mockReleaseExecutionSlot).toHaveBeenCalledWith('execution-1')
    expect(mockPublishWorkflowGroupCancellationEvent).not.toHaveBeenCalled()
    expect(mockUpdateSet).not.toHaveBeenCalled()
  })

  it('keeps the reservation held when an unexpected workflow-group failure follows a paused cancellation', async () => {
    mockResolveWorkflowExecutionOwnership.mockResolvedValue({
      belongsToWorkflow: true,
      workflowGroupWorkspaceId: 'workspace-1',
    })
    mockBeginPausedCancellation.mockResolvedValue(true)
    mockCancelWorkflowGroupExecution.mockRejectedValue(new Error('serialization conflict'))

    await expect(cancelWorkflowExecution(INPUT)).rejects.toThrow('serialization conflict')
    expect(mockReleaseExecutionSlot).not.toHaveBeenCalled()
  })

  it('keeps the reservation held when an unexpected workflow-group failure follows a failed cancellation', async () => {
    mockResolveWorkflowExecutionOwnership.mockResolvedValue({
      belongsToWorkflow: true,
      workflowGroupWorkspaceId: 'workspace-1',
    })
    mockMarkExecutionCancelled.mockResolvedValue({
      durablyRecorded: false,
      reason: 'redis_unavailable',
    })
    mockCancelWorkflowGroupExecution.mockRejectedValue(new Error('serialization conflict'))

    await expect(cancelWorkflowExecution(INPUT)).rejects.toThrow('serialization conflict')
    expect(mockReleaseExecutionSlot).not.toHaveBeenCalled()
  })

  it('leaves a standalone execution untouched by the workflow-group path', async () => {
    await cancelWorkflowExecution(INPUT)

    expect(mockCancelWorkflowGroupExecution).not.toHaveBeenCalled()
    expect(mockPublishWorkflowGroupCancellationEvent).not.toHaveBeenCalled()
    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }))
  })
})
