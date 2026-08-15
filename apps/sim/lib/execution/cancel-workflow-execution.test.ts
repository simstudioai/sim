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
  mockUpdateReturning,
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
  mockUpdateReturning: vi.fn(),
  mockResolveWorkflowExecutionOwnership: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    update: () => ({
      set: (values: unknown) => {
        mockUpdateSet(values)
        return { where: () => ({ returning: () => Promise.resolve(mockUpdateReturning()) }) }
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

/**
 * The durable writes a workflow-group transition reports back. The transaction
 * updates the workflow log only, the cell sidecar only, or both, so a single
 * `kind` cannot answer whether this request wrote anything.
 */
const NO_WRITES = { workflowLogTerminalized: false, sidecarCancelled: false } as const
const LOG_WRITE = { workflowLogTerminalized: true, sidecarCancelled: false } as const
const SIDECAR_WRITE = { workflowLogTerminalized: false, sidecarCancelled: true } as const
const BOTH_WRITES = { workflowLogTerminalized: true, sidecarCancelled: true } as const

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
      priorStatus: 'running',
    })
    mockUpdateReturning.mockReturnValue([{ id: 'log-1' }])
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

  /**
   * The row reads `cancelled` after a successful cancel just as it does after
   * someone else's, so a status re-read alone would report this run's own work
   * as `already_cancelled`. Nothing is re-read once the claim moved a row.
   */
  it('reports a durable write when an active run is cancelled', async () => {
    mockResolveWorkflowExecutionOwnership
      .mockResolvedValueOnce({
        belongsToWorkflow: true,
        workflowGroupWorkspaceId: null,
        priorStatus: 'running',
      })
      .mockResolvedValue({
        belongsToWorkflow: true,
        workflowGroupWorkspaceId: null,
        priorStatus: 'cancelled',
      })

    const result = await cancelWorkflowExecution(INPUT)

    expect(result).toMatchObject({ success: true, durablyRecorded: true, reason: 'recorded' })
    expect(mockResolveWorkflowExecutionOwnership).toHaveBeenCalledTimes(1)
  })

  /**
   * A cancel against a run that already reached a terminal state changes
   * nothing: the log claim's `status = 'running'` predicate matches no row and
   * no terminal metadata moves. Reporting `recorded`/`durablyRecorded: true`
   * there tells a caller a durable write happened when none did, so the outcome
   * names the state that was actually observed instead.
   */
  it.each([
    ['cancelled', 'already_cancelled'],
    ['completed', 'already_completed'],
    ['failed', 'already_failed'],
  ])('reports a run already %s as a no-op rather than a durable write', async (status, reason) => {
    mockResolveWorkflowExecutionOwnership.mockResolvedValue({
      belongsToWorkflow: true,
      workflowGroupWorkspaceId: null,
      priorStatus: status,
    })
    mockUpdateReturning.mockReturnValue([])

    const result = await cancelWorkflowExecution(INPUT)

    expect(result).toMatchObject({ success: true, durablyRecorded: false, reason })
  })

  /**
   * Reclassification only ever applies to an otherwise-clean outcome. A run that
   * reached any terminal status can still carry paused-HITL state — a
   * force-failed run keeps whatever pause rows it had — and when reconciling
   * that genuinely fails, the caller is owed the step that failed rather than a
   * no-op that also flips `success` to `true`.
   */
  it.each([['cancelled'], ['completed'], ['failed']])(
    'still reports the failing step when a %s run has paused work left over',
    async (status) => {
      mockResolveWorkflowExecutionOwnership.mockResolvedValue({
        belongsToWorkflow: true,
        workflowGroupWorkspaceId: null,
        priorStatus: status,
      })
      mockBeginPausedCancellation.mockResolvedValue(true)
      mockCompletePausedCancellation.mockResolvedValue(false)

      const result = await cancelWorkflowExecution(INPUT)

      expect(result).toMatchObject({
        success: false,
        durablyRecorded: true,
        reason: 'paused_database_cancel_failed',
      })
    }
  )

  /**
   * The status read at entry can be stale: a run that finishes after it and
   * before the claim leaves a `running` snapshot on a cancel whose claim matched
   * no row. The claim's own row count is what separates that from a cancel this
   * request really performed.
   */
  it.each([
    ['completed', 'already_completed'],
    ['failed', 'already_failed'],
  ])('reports a run that reached %s after the entry read as a no-op', async (status, reason) => {
    mockResolveWorkflowExecutionOwnership
      .mockResolvedValueOnce({
        belongsToWorkflow: true,
        workflowGroupWorkspaceId: null,
        priorStatus: 'running',
      })
      .mockResolvedValueOnce({
        belongsToWorkflow: true,
        workflowGroupWorkspaceId: null,
        priorStatus: status,
      })
    mockUpdateReturning.mockReturnValue([])

    const result = await cancelWorkflowExecution(INPUT)

    expect(result).toMatchObject({ success: true, durablyRecorded: false, reason })
  })

  it('reports an undifferentiated outcome when the claim finds no durable log row', async () => {
    mockResolveWorkflowExecutionOwnership.mockResolvedValue({
      belongsToWorkflow: true,
      workflowGroupWorkspaceId: null,
      priorStatus: null,
    })
    mockUpdateReturning.mockReturnValue([])

    const result = await cancelWorkflowExecution(INPUT)

    expect(result).toMatchObject({ success: true, durablyRecorded: true, reason: 'recorded' })
  })

  /**
   * The re-read is purely observational — it only refines *which* no-op the
   * caller is told about. A database that cannot answer it must not take the
   * cancel down with it: the run has already been cancelled in Redis and its
   * reservation still has to be released, so the failure degrades to the
   * undifferentiated outcome rather than propagating.
   */
  it('degrades to the undifferentiated outcome when the status re-read fails', async () => {
    mockResolveWorkflowExecutionOwnership
      .mockResolvedValueOnce({
        belongsToWorkflow: true,
        workflowGroupWorkspaceId: null,
        priorStatus: 'running',
      })
      .mockRejectedValueOnce(new Error('connection terminated'))
    mockUpdateReturning.mockReturnValue([])

    const result = await cancelWorkflowExecution(INPUT)

    expect(result).toMatchObject({ success: true, durablyRecorded: true, reason: 'recorded' })
    expect(mockResolveWorkflowExecutionOwnership).toHaveBeenCalledTimes(2)
    expect(mockReleaseExecutionSlot).toHaveBeenCalledWith('execution-1')
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
      priorStatus: 'running',
    })
    const cancelled = {
      kind: 'cancelled' as const,
      tableId: 'table-1',
      rowId: 'row-1',
      groupId: 'group-1',
      writes: BOTH_WRITES,
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

  /**
   * A workflow-group log that is already `cancelled` can still own a cell
   * sidecar left in `error`, and reconciling it to `cancelled` is a durable
   * write this request performed. The terminal entry snapshot cannot see that
   * work, so it must not reinterpret the outcome as a no-op — the API would
   * otherwise tell the caller nothing changed and drop the cancellation event.
   */
  it('reports a durable write when a cancelled group run still had its sidecar reconciled', async () => {
    mockResolveWorkflowExecutionOwnership.mockResolvedValue({
      belongsToWorkflow: true,
      workflowGroupWorkspaceId: 'workspace-1',
      priorStatus: 'cancelled',
    })
    const cancelled = {
      kind: 'cancelled' as const,
      tableId: 'table-1',
      rowId: 'row-1',
      groupId: 'group-1',
      writes: SIDECAR_WRITE,
    }
    mockCancelWorkflowGroupExecution.mockResolvedValue(cancelled)

    const result = await cancelWorkflowExecution(INPUT)

    expect(result).toMatchObject({ success: true, durablyRecorded: true, reason: 'recorded' })
    expect(mockPublishWorkflowGroupCancellationEvent).toHaveBeenCalledWith(cancelled, 'execution-1')
  })

  /**
   * The group path terminalizes the workflow log itself when the cell sidecar
   * is already gone, so that outcome is a durable write too.
   */
  it('reports a durable write when the group path cancels a run whose sidecar is gone', async () => {
    mockResolveWorkflowExecutionOwnership.mockResolvedValue({
      belongsToWorkflow: true,
      workflowGroupWorkspaceId: 'workspace-1',
      priorStatus: 'running',
    })
    mockCancelWorkflowGroupExecution.mockResolvedValue({
      kind: 'cancelled_without_sidecar',
      writes: LOG_WRITE,
    })

    const result = await cancelWorkflowExecution(INPUT)

    expect(result).toMatchObject({ success: true, durablyRecorded: true, reason: 'recorded' })
    expect(mockUpdateSet).not.toHaveBeenCalled()
  })

  /**
   * The mirror case: a group run that was already terminal and whose sidecar was
   * already `cancelled` leaves both records untouched, so it still reports the
   * state it observed rather than a durable write.
   */
  it('reports a group run that changed nothing as a no-op', async () => {
    mockResolveWorkflowExecutionOwnership.mockResolvedValue({
      belongsToWorkflow: true,
      workflowGroupWorkspaceId: 'workspace-1',
      priorStatus: 'cancelled',
    })
    mockCancelWorkflowGroupExecution.mockResolvedValue({
      kind: 'already_cancelled',
      tableId: 'table-1',
      rowId: 'row-1',
      groupId: 'group-1',
      writes: NO_WRITES,
    })

    const result = await cancelWorkflowExecution(INPUT)

    expect(result).toMatchObject({
      success: true,
      durablyRecorded: false,
      reason: 'already_cancelled',
    })
  })

  /**
   * The same `already_cancelled` kind covers a transition that left the sidecar
   * alone but still terminalized an active workflow log. That log write is
   * durable, so the outcome must stay `recorded` and must not re-read a state
   * this request itself wrote.
   */
  it('reports a durable write when a group run only repaired its workflow log', async () => {
    mockResolveWorkflowExecutionOwnership.mockResolvedValue({
      belongsToWorkflow: true,
      workflowGroupWorkspaceId: 'workspace-1',
      priorStatus: 'running',
    })
    mockCancelWorkflowGroupExecution.mockResolvedValue({
      kind: 'already_cancelled',
      tableId: 'table-1',
      rowId: 'row-1',
      groupId: 'group-1',
      writes: LOG_WRITE,
    })

    const result = await cancelWorkflowExecution(INPUT)

    expect(result).toMatchObject({ success: true, durablyRecorded: true, reason: 'recorded' })
    expect(mockResolveWorkflowExecutionOwnership).toHaveBeenCalledOnce()
  })

  /**
   * The lost race the sidecar-bearing kind used to hide: a concurrent cancel
   * terminalized both records between the entry snapshot and this transaction,
   * which then found the sidecar already `cancelled` and the log already
   * `cancelled` and wrote nothing. A non-terminal entry snapshot cannot catch
   * that, so the transition's own report of having written nothing is what
   * forces the re-read — otherwise the request would claim a durable write and
   * fire the v2 cancel analytics gate on a no-op.
   */
  it('reports a group run that lost the race with its sidecar already cancelled as a no-op', async () => {
    mockResolveWorkflowExecutionOwnership
      .mockResolvedValueOnce({
        belongsToWorkflow: true,
        workflowGroupWorkspaceId: 'workspace-1',
        priorStatus: 'running',
      })
      .mockResolvedValueOnce({
        belongsToWorkflow: true,
        workflowGroupWorkspaceId: 'workspace-1',
        priorStatus: 'cancelled',
      })
    mockCancelWorkflowGroupExecution.mockResolvedValue({
      kind: 'already_cancelled',
      tableId: 'table-1',
      rowId: 'row-1',
      groupId: 'group-1',
      writes: NO_WRITES,
    })

    const result = await cancelWorkflowExecution(INPUT)

    expect(result).toMatchObject({
      success: true,
      durablyRecorded: false,
      reason: 'already_cancelled',
    })
    expect(mockResolveWorkflowExecutionOwnership).toHaveBeenCalledTimes(2)
  })

  /**
   * The lost-race re-read applies to the group path as well: an entry snapshot
   * can still read `running` when the sidecar-less transition finds the log
   * already `cancelled` and writes nothing.
   */
  it('reports a group run that lost the race to another cancel as a no-op', async () => {
    mockResolveWorkflowExecutionOwnership
      .mockResolvedValueOnce({
        belongsToWorkflow: true,
        workflowGroupWorkspaceId: 'workspace-1',
        priorStatus: 'running',
      })
      .mockResolvedValueOnce({
        belongsToWorkflow: true,
        workflowGroupWorkspaceId: 'workspace-1',
        priorStatus: 'cancelled',
      })
    mockCancelWorkflowGroupExecution.mockResolvedValue({
      kind: 'already_cancelled_without_sidecar',
      writes: NO_WRITES,
    })

    const result = await cancelWorkflowExecution(INPUT)

    expect(result).toMatchObject({
      success: true,
      durablyRecorded: false,
      reason: 'already_cancelled',
    })
    expect(mockResolveWorkflowExecutionOwnership).toHaveBeenCalledTimes(2)
  })

  it.each([
    [
      { kind: 'conflict' as const, status: 'completed', writes: NO_WRITES },
      'cannot be cancelled while completed',
    ],
    [
      { kind: 'not_workflow_group' as const, writes: NO_WRITES },
      'no longer the active table execution',
    ],
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
    [{ kind: 'conflict' as const, status: 'completed', writes: NO_WRITES }],
    [{ kind: 'not_workflow_group' as const, writes: NO_WRITES }],
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
    [{ kind: 'conflict' as const, status: 'completed', writes: NO_WRITES }],
    [{ kind: 'not_workflow_group' as const, writes: NO_WRITES }],
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
      priorStatus: 'running',
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
      priorStatus: 'running',
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
      priorStatus: 'running',
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

  /**
   * A cancelled run is terminal, so it owes the same two fields every other
   * terminal write records. Without the duration it is invisible to the
   * `minDurationMs`/`maxDurationMs` filters on `GET /api/v2/logs`.
   */
  it('records how long the cancelled run had been going, not just when it stopped', async () => {
    await cancelWorkflowExecution(INPUT)

    const [values] = mockUpdateSet.mock.calls.at(-1) as [Record<string, unknown>]
    expect(values.endedAt).toBeInstanceOf(Date)
    expect(values.totalDurationMs).toBeDefined()
  })
})
