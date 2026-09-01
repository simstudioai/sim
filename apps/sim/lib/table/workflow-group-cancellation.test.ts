/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAppendTableEvent } = vi.hoisted(() => ({
  mockAppendTableEvent: vi.fn(),
}))

vi.mock('@/lib/table/events', () => ({
  appendTableEvent: mockAppendTableEvent,
}))

import {
  cancelWorkflowGroupExecution,
  publishWorkflowGroupCancellationEvent,
} from '@/lib/table/workflow-group-cancellation'

const OPTIONS = {
  workspaceId: 'workspace-1',
  workflowId: 'workflow-1',
  executionId: 'execution-1',
}

const NO_WRITES = { workflowLogTerminalized: false, sidecarCancelled: false } as const

const ACTIVE_TARGET = {
  tableId: 'table-1',
  rowId: 'row-1',
  groupId: 'group-1',
  status: 'running',
  blockErrors: { 'block-1': 'Provider failed' },
}

function collectConditionValues(value: unknown): unknown[] {
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  const values: unknown[] = []
  if ('right' in record) values.push(record.right)
  if ('values' in record) values.push(record.values)
  if (Array.isArray(record.conditions)) {
    for (const condition of record.conditions) values.push(...collectConditionValues(condition))
  }
  return values
}

describe('cancelWorkflowGroupExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockAppendTableEvent.mockResolvedValue(null)
  })

  it('claims only the exact active cell attempt without publishing before signalling', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ status: 'running' }])
      .mockResolvedValueOnce([ACTIVE_TARGET])
    dbChainMockFns.returning
      .mockResolvedValueOnce([{ status: 'cancelled' }])
      .mockResolvedValueOnce([{ status: 'cancelled' }])

    await expect(cancelWorkflowGroupExecution(OPTIONS)).resolves.toEqual({
      kind: 'cancelled',
      tableId: 'table-1',
      rowId: 'row-1',
      groupId: 'group-1',
      blockErrors: { 'block-1': 'Provider failed' },
      writes: { workflowLogTerminalized: true, sidecarCancelled: true },
    })

    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
    expect(dbChainMockFns.for).toHaveBeenNthCalledWith(1, 'update')
    expect(dbChainMockFns.for).toHaveBeenNthCalledWith(2, 'update', expect.any(Object))
    const logLookupValues = collectConditionValues(dbChainMockFns.where.mock.calls[0]?.[0])
    expect(logLookupValues).toEqual(
      expect.arrayContaining(['workspace-1', 'workflow-1', 'execution-1'])
    )
    const sidecarLookupValues = collectConditionValues(dbChainMockFns.where.mock.calls[1]?.[0])
    expect(sidecarLookupValues).toEqual(
      expect.arrayContaining(['workspace-1', 'workflow-1', 'execution-1'])
    )
    expect(dbChainMockFns.set).toHaveBeenNthCalledWith(1, {
      status: 'cancelled',
      endedAt: expect.any(Date),
      totalDurationMs: expect.anything(),
      executionDeadlineAt: null,
    })
    expect(dbChainMockFns.set).toHaveBeenNthCalledWith(2, {
      status: 'cancelled',
      jobId: null,
      error: 'Cancelled',
      runningBlockIds: [],
      cancelledAt: expect.any(Date),
      updatedAt: expect.any(Date),
    })
    const logUpdateValues = collectConditionValues(dbChainMockFns.where.mock.calls[2]?.[0])
    expect(logUpdateValues).toEqual(
      expect.arrayContaining(['workspace-1', 'workflow-1', 'execution-1', ['running', 'pending']])
    )
    const sidecarUpdateValues = collectConditionValues(dbChainMockFns.where.mock.calls[3]?.[0])
    expect(sidecarUpdateValues).toEqual(
      expect.arrayContaining([
        'table-1',
        'row-1',
        'group-1',
        'workflow-1',
        'execution-1',
        ['queued', 'running', 'pending'],
      ])
    )
    expect(mockAppendTableEvent).not.toHaveBeenCalled()
  })

  it('publishes the claimed cancellation with its preserved block errors', async () => {
    await publishWorkflowGroupCancellationEvent(
      {
        kind: 'cancelled',
        tableId: 'table-1',
        rowId: 'row-1',
        groupId: 'group-1',
        blockErrors: { 'block-1': 'Provider failed' },
      },
      'execution-1'
    )

    expect(mockAppendTableEvent).toHaveBeenCalledOnce()
    expect(mockAppendTableEvent).toHaveBeenCalledWith({
      kind: 'cell',
      tableId: 'table-1',
      rowId: 'row-1',
      groupId: 'group-1',
      status: 'cancelled',
      executionId: 'execution-1',
      jobId: null,
      error: 'Cancelled',
      blockErrors: { 'block-1': 'Provider failed' },
    })
  })

  it('idempotently republishes an already-cancelled sidecar', async () => {
    await publishWorkflowGroupCancellationEvent(
      {
        kind: 'already_cancelled',
        tableId: 'table-1',
        rowId: 'row-1',
        groupId: 'group-1',
      },
      'execution-1'
    )

    expect(mockAppendTableEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'cell',
        tableId: 'table-1',
        rowId: 'row-1',
        groupId: 'group-1',
        executionId: 'execution-1',
        status: 'cancelled',
      })
    )
  })

  it('falls through for regular executions without a workflow-group sidecar', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ status: 'running', trigger: 'api', executionData: {} }])
      .mockResolvedValueOnce([])

    await expect(cancelWorkflowGroupExecution(OPTIONS)).resolves.toEqual({
      kind: 'not_workflow_group',
      writes: NO_WRITES,
    })

    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mockAppendTableEvent).not.toHaveBeenCalled()
  })

  it('does not infer workflow-group origin from an uncorrelated table log', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ status: 'running', trigger: 'table', executionData: {} }])
      .mockResolvedValueOnce([])

    await expect(cancelWorkflowGroupExecution(OPTIONS)).resolves.toEqual({
      kind: 'not_workflow_group',
      writes: NO_WRITES,
    })

    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mockAppendTableEvent).not.toHaveBeenCalled()
  })

  it('preserves normal cancellation for a positively identified Table trigger', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          status: 'running',
          trigger: 'table',
          executionData: { correlation: { source: 'webhook' } },
        },
      ])
      .mockResolvedValueOnce([])

    await expect(cancelWorkflowGroupExecution(OPTIONS)).resolves.toEqual({
      kind: 'not_workflow_group',
      writes: NO_WRITES,
    })

    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mockAppendTableEvent).not.toHaveBeenCalled()
  })

  it('terminalizes a durable workflow-group log after its sidecar was deleted', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          status: 'running',
          executionData: { correlation: { source: 'workflow_group' } },
        },
      ])
      .mockResolvedValueOnce([])
    dbChainMockFns.returning.mockResolvedValueOnce([{ status: 'cancelled' }])

    await expect(cancelWorkflowGroupExecution(OPTIONS)).resolves.toEqual({
      kind: 'cancelled_without_sidecar',
      writes: { workflowLogTerminalized: true, sidecarCancelled: false },
    })

    expect(dbChainMockFns.update).toHaveBeenCalledOnce()
    /**
     * `totalDurationMs` is derived in-statement from the row's `started_at`, so
     * a cancelled run carries the duration every other terminal write records
     * and stays visible to the `/api/v2/logs` duration filters.
     */
    expect(dbChainMockFns.set).toHaveBeenCalledWith({
      status: 'cancelled',
      endedAt: expect.any(Date),
      totalDurationMs: expect.anything(),
      executionDeadlineAt: null,
    })
    const logUpdateValues = collectConditionValues(dbChainMockFns.where.mock.calls[2]?.[0])
    expect(logUpdateValues).toEqual(
      expect.arrayContaining(['workspace-1', 'workflow-1', 'execution-1', ['running', 'pending']])
    )
    expect(mockAppendTableEvent).not.toHaveBeenCalled()
  })

  it('treats a durable cancelled log without a sidecar as an idempotent retry', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          status: 'cancelled',
          executionData: { correlation: { source: 'workflow_group' } },
        },
      ])
      .mockResolvedValueOnce([])

    await expect(cancelWorkflowGroupExecution(OPTIONS)).resolves.toEqual({
      kind: 'already_cancelled_without_sidecar',
      writes: NO_WRITES,
    })

    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mockAppendTableEvent).not.toHaveBeenCalled()
  })

  it('does not classify a nested legacy correlation without the durable top-level marker', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          status: 'cancelled',
          executionData: {
            trigger: { data: { correlation: { source: 'workflow_group' } } },
          },
        },
      ])
      .mockResolvedValueOnce([])

    await expect(cancelWorkflowGroupExecution(OPTIONS)).resolves.toEqual({
      kind: 'not_workflow_group',
      writes: NO_WRITES,
    })

    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mockAppendTableEvent).not.toHaveBeenCalled()
  })

  it('does not overwrite a terminal durable log whose sidecar was deleted', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          status: 'completed',
          executionData: { correlation: { source: 'workflow_group' } },
        },
      ])
      .mockResolvedValueOnce([])

    await expect(cancelWorkflowGroupExecution(OPTIONS)).resolves.toEqual({
      kind: 'conflict',
      status: 'completed',
      writes: NO_WRITES,
    })

    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mockAppendTableEvent).not.toHaveBeenCalled()
  })

  it('keeps publication best-effort after the durable claim commits', async () => {
    mockAppendTableEvent.mockRejectedValueOnce(new Error('event buffer unavailable'))

    await expect(
      publishWorkflowGroupCancellationEvent(
        {
          kind: 'cancelled',
          tableId: 'table-1',
          rowId: 'row-1',
          groupId: 'group-1',
        },
        'execution-1'
      )
    ).resolves.toBeUndefined()
  })

  it('conflicts when the matching sidecar is already terminal', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ status: 'running' }])
      .mockResolvedValueOnce([{ ...ACTIVE_TARGET, status: 'completed' }])

    await expect(cancelWorkflowGroupExecution(OPTIONS)).resolves.toEqual({
      kind: 'conflict',
      status: 'completed',
      writes: NO_WRITES,
    })

    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mockAppendTableEvent).not.toHaveBeenCalled()
  })

  it('treats the same already-cancelled attempt as an idempotent retry', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ status: 'cancelled' }])
      .mockResolvedValueOnce([{ ...ACTIVE_TARGET, status: 'cancelled' }])

    await expect(cancelWorkflowGroupExecution(OPTIONS)).resolves.toEqual({
      kind: 'already_cancelled',
      tableId: 'table-1',
      rowId: 'row-1',
      groupId: 'group-1',
      blockErrors: { 'block-1': 'Provider failed' },
      writes: NO_WRITES,
    })

    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mockAppendTableEvent).not.toHaveBeenCalled()
  })

  it('repairs a cancelled log with an active exact sidecar in the same transaction', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ status: 'cancelled' }])
      .mockResolvedValueOnce([ACTIVE_TARGET])
    dbChainMockFns.returning.mockResolvedValueOnce([{ status: 'cancelled' }])

    await expect(cancelWorkflowGroupExecution(OPTIONS)).resolves.toEqual({
      kind: 'cancelled',
      tableId: 'table-1',
      rowId: 'row-1',
      groupId: 'group-1',
      blockErrors: { 'block-1': 'Provider failed' },
      writes: { workflowLogTerminalized: false, sidecarCancelled: true },
    })

    expect(dbChainMockFns.update).toHaveBeenCalledOnce()
    expect(mockAppendTableEvent).not.toHaveBeenCalled()
  })

  it('canonicalizes the exact worker error after cancellation owns the workflow log', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ status: 'cancelled' }])
      .mockResolvedValueOnce([{ ...ACTIVE_TARGET, status: 'error' }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ status: 'cancelled' }])

    await expect(cancelWorkflowGroupExecution(OPTIONS)).resolves.toEqual({
      kind: 'cancelled',
      tableId: 'table-1',
      rowId: 'row-1',
      groupId: 'group-1',
      blockErrors: { 'block-1': 'Provider failed' },
      writes: { workflowLogTerminalized: false, sidecarCancelled: true },
    })

    const sidecarUpdateValues = collectConditionValues(dbChainMockFns.where.mock.calls[2]?.[0])
    expect(sidecarUpdateValues).toEqual(
      expect.arrayContaining([
        'table-1',
        'row-1',
        'group-1',
        'workflow-1',
        'execution-1',
        ['queued', 'running', 'pending', 'error'],
      ])
    )
    expect(mockAppendTableEvent).not.toHaveBeenCalled()
  })

  it('does not reinterpret an error sidecar while the workflow log remains active', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ status: 'running' }])
      .mockResolvedValueOnce([{ ...ACTIVE_TARGET, status: 'error' }])

    await expect(cancelWorkflowGroupExecution(OPTIONS)).resolves.toEqual({
      kind: 'conflict',
      status: 'error',
      writes: NO_WRITES,
    })

    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mockAppendTableEvent).not.toHaveBeenCalled()
  })

  it('repairs an already-cancelled sidecar while preserving idempotent route semantics', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ status: 'running' }])
      .mockResolvedValueOnce([{ ...ACTIVE_TARGET, status: 'cancelled' }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ status: 'cancelled' }])

    await expect(cancelWorkflowGroupExecution(OPTIONS)).resolves.toEqual({
      kind: 'already_cancelled',
      tableId: 'table-1',
      rowId: 'row-1',
      groupId: 'group-1',
      blockErrors: { 'block-1': 'Provider failed' },
      writes: { workflowLogTerminalized: true, sidecarCancelled: false },
    })

    expect(dbChainMockFns.update).toHaveBeenCalledOnce()
    expect(mockAppendTableEvent).not.toHaveBeenCalled()
  })

  it.each(['completed', 'failed'])(
    'leaves the sidecar untouched when workflow %s wins the log lock',
    async (status) => {
      dbChainMockFns.limit
        .mockResolvedValueOnce([{ status }])
        .mockResolvedValueOnce([ACTIVE_TARGET])

      await expect(cancelWorkflowGroupExecution(OPTIONS)).resolves.toEqual({
        kind: 'conflict',
        status,
        writes: NO_WRITES,
      })

      expect(dbChainMockFns.update).not.toHaveBeenCalled()
      expect(mockAppendTableEvent).not.toHaveBeenCalled()
    }
  )

  it('rolls back instead of accepting a partial terminal claim', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ status: 'running' }])
      .mockResolvedValueOnce([ACTIVE_TARGET])
    dbChainMockFns.returning
      .mockResolvedValueOnce([{ status: 'cancelled' }])
      .mockResolvedValueOnce([])

    await expect(cancelWorkflowGroupExecution(OPTIONS)).rejects.toThrow(
      'Workflow-group cancellation lost its locked table-sidecar claim'
    )

    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
    expect(mockAppendTableEvent).not.toHaveBeenCalled()
  })
})
