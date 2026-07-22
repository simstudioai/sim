/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RowExecutionMetadata, TableDefinition, WorkflowGroup } from '@/lib/table/types'

const { mockAppendTableEvent, mockUpdateRow, mockWriteExecutionsPatch } = vi.hoisted(() => ({
  mockAppendTableEvent: vi.fn(),
  mockUpdateRow: vi.fn(),
  mockWriteExecutionsPatch: vi.fn(),
}))

vi.mock('@sim/db', () => dbChainMock)

vi.mock('@/lib/table/events', () => ({
  appendTableEvent: mockAppendTableEvent,
}))

vi.mock('@/lib/table/rows/executions', () => ({
  writeExecutionsPatch: mockWriteExecutionsPatch,
}))

vi.mock('@/lib/table/rows/service', () => ({
  updateRow: mockUpdateRow,
}))

import { createWorkflowCellProgressWriter, writeWorkflowGroupState } from '@/lib/table/cell-write'

const TABLE: TableDefinition = {
  id: 'table-1',
  name: 'Leads',
  schema: {
    columns: [
      { id: 'first-output', name: 'First output', type: 'string' },
      { id: 'second-output', name: 'Second output', type: 'string' },
    ],
  },
  rowCount: 1,
  maxRows: 100,
  workspaceId: 'workspace-1',
  createdBy: 'user-1',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

const GROUP: WorkflowGroup = {
  id: 'group-1',
  workflowId: 'workflow-1',
  outputs: [
    { blockId: 'block-1', path: 'value', columnName: 'first-output' },
    { blockId: 'block-2', path: 'value', columnName: 'second-output' },
  ],
}

const CONTEXT = {
  tableId: TABLE.id,
  rowId: 'row-1',
  workspaceId: TABLE.workspaceId,
  groupId: GROUP.id,
  executionId: 'execution-1',
  requestId: 'request-1',
  table: TABLE,
}

const RUNNING_STATE: RowExecutionMetadata = {
  status: 'running',
  executionId: CONTEXT.executionId,
  jobId: null,
  workflowId: GROUP.workflowId,
  error: null,
}

describe('writeWorkflowGroupState', () => {
  afterAll(() => {
    resetDbChainMock()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockWriteExecutionsPatch.mockResolvedValue('wrote')
    mockUpdateRow.mockResolvedValue({})
    mockAppendTableEvent.mockResolvedValue(null)
  })

  it('persists a status-only transition with one guarded execution write', async () => {
    await expect(writeWorkflowGroupState(CONTEXT, { executionState: RUNNING_STATE })).resolves.toBe(
      'wrote'
    )

    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
    expect(mockWriteExecutionsPatch).toHaveBeenCalledWith(
      expect.anything(),
      TABLE.id,
      CONTEXT.rowId,
      { [GROUP.id]: RUNNING_STATE },
      { groupId: GROUP.id, executionId: CONTEXT.executionId }
    )
    expect(mockUpdateRow).not.toHaveBeenCalled()
    expect(mockAppendTableEvent).toHaveBeenCalledWith({
      kind: 'cell',
      tableId: TABLE.id,
      rowId: CONTEXT.rowId,
      groupId: GROUP.id,
      status: 'running',
      executionId: CONTEXT.executionId,
      jobId: null,
      error: null,
    })
  })

  it('writes only changed data while emitting cumulative outputs', async () => {
    await expect(
      writeWorkflowGroupState(CONTEXT, {
        executionState: RUNNING_STATE,
        dataPatch: { 'second-output': 'second' },
        eventOutputs: {
          'first-output': 'first',
          'second-output': 'second',
        },
      })
    ).resolves.toBe('wrote')

    expect(mockUpdateRow).toHaveBeenCalledWith(
      {
        tableId: TABLE.id,
        rowId: CONTEXT.rowId,
        data: { 'second-output': 'second' },
        workspaceId: TABLE.workspaceId,
        executionsPatch: { [GROUP.id]: RUNNING_STATE },
        cancellationGuard: { groupId: GROUP.id, executionId: CONTEXT.executionId },
      },
      TABLE,
      CONTEXT.requestId,
      { dataWriteMode: 'patch' }
    )
    expect(mockAppendTableEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        outputs: {
          'first-output': 'first',
          'second-output': 'second',
        },
      })
    )
  })

  it('suppresses events when stale or cancelled SQL guards reject writes', async () => {
    mockWriteExecutionsPatch.mockResolvedValueOnce('guard-rejected')
    await expect(writeWorkflowGroupState(CONTEXT, { executionState: RUNNING_STATE })).resolves.toBe(
      'skipped'
    )

    mockUpdateRow.mockResolvedValueOnce(null)
    await expect(
      writeWorkflowGroupState(CONTEXT, {
        executionState: RUNNING_STATE,
        dataPatch: { 'first-output': 'late' },
        eventOutputs: { 'first-output': 'late' },
      })
    ).resolves.toBe('skipped')

    expect(mockAppendTableEvent).not.toHaveBeenCalled()
  })
})

describe('createWorkflowCellProgressWriter', () => {
  it('keeps callback count and cumulative event order while bounding DB patches to each block', async () => {
    const writeProgress = vi.fn().mockResolvedValue('wrote')
    const progress = createWorkflowCellProgressWriter({
      group: GROUP,
      writeProgress,
      onWriteError: vi.fn(),
    })

    await progress.onBlockStart('block-1')
    await progress.onBlockComplete('block-1', { output: { value: 'first' } })
    await progress.onBlockStart('block-2')
    await progress.onBlockComplete('block-2', { output: { value: 'second' } })
    await progress.waitForPendingWrites()

    expect(writeProgress).toHaveBeenCalledTimes(4)
    expect(writeProgress.mock.calls.map(([write]) => write)).toEqual([
      {
        dataPatch: undefined,
        eventOutputs: {},
        runningBlockIds: ['block-1'],
        blockErrors: {},
      },
      {
        dataPatch: { 'first-output': 'first' },
        eventOutputs: { 'first-output': 'first' },
        runningBlockIds: [],
        blockErrors: {},
      },
      {
        dataPatch: undefined,
        eventOutputs: { 'first-output': 'first' },
        runningBlockIds: ['block-2'],
        blockErrors: {},
      },
      {
        dataPatch: { 'second-output': 'second' },
        eventOutputs: {
          'first-output': 'first',
          'second-output': 'second',
        },
        runningBlockIds: [],
        blockErrors: {},
      },
    ])
    expect(progress.getPendingDataPatch()).toEqual({})
    expect(progress.getEventOutputs()).toEqual({
      'first-output': 'first',
      'second-output': 'second',
    })

    await progress.finish()
  })

  it('retains only failed changed fields for the terminal recovery write', async () => {
    const writeProgress = vi.fn().mockRejectedValueOnce(new Error('temporary write failure'))
    const progress = createWorkflowCellProgressWriter({
      group: GROUP,
      writeProgress,
      onWriteError: vi.fn(),
    })

    await progress.onBlockComplete('block-1', { output: { value: 'first' } })
    await progress.waitForPendingWrites()

    expect(progress.getPendingDataPatch()).toEqual({ 'first-output': 'first' })
    expect(progress.getEventOutputs()).toEqual({ 'first-output': 'first' })

    await progress.finish()
  })

  it('retries a failed changed patch on the next ordered progress write', async () => {
    const writeProgress = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary write failure'))
      .mockResolvedValue('wrote')
    const progress = createWorkflowCellProgressWriter({
      group: GROUP,
      writeProgress,
      onWriteError: vi.fn(),
    })

    await progress.onBlockComplete('block-1', { output: { value: 'first' } })
    await progress.waitForPendingWrites()
    await progress.onBlockStart('block-2')
    await progress.waitForPendingWrites()

    expect(writeProgress).toHaveBeenNthCalledWith(2, {
      dataPatch: { 'first-output': 'first' },
      eventOutputs: { 'first-output': 'first' },
      runningBlockIds: ['block-2'],
      blockErrors: {},
    })
    expect(progress.getPendingDataPatch()).toEqual({})

    await progress.finish()
  })
})
