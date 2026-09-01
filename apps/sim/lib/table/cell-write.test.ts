/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TableRowNotFoundError } from '@/lib/table/rows/errors'
import type { RowExecutionMetadata, TableDefinition, WorkflowGroup } from '@/lib/table/types'

const { mockAppendTableEvent, mockDecryptSecret, mockUpdateRow, mockWriteExecutionsPatch } =
  vi.hoisted(() => ({
    mockAppendTableEvent: vi.fn(),
    mockDecryptSecret: vi.fn(),
    mockUpdateRow: vi.fn(),
    mockWriteExecutionsPatch: vi.fn(),
  }))

vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: mockDecryptSecret,
}))

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
      {
        id: 'status-output',
        name: 'Status output',
        type: 'select',
        options: [
          { id: 'opt_open', name: 'Open' },
          { id: 'opt_closed', name: 'Closed' },
        ],
      },
    ],
  },
  rowCount: 1,
  maxRows: 100,
  workspaceId: 'workspace-1',
  createdBy: 'user-1',
  locks: { schemaLocked: false, insertLocked: false, updateLocked: false, deleteLocked: false },
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
    queueTableRows(schemaMock.userTableRows, [{ id: CONTEXT.rowId }])
    mockWriteExecutionsPatch.mockResolvedValue('wrote')
    mockUpdateRow.mockResolvedValue({})
    mockAppendTableEvent.mockResolvedValue(null)
    mockDecryptSecret.mockImplementation(async (encryptedValue: string) => ({
      decrypted: encryptedValue === 'encrypted-secret' ? 'secret-value' : encryptedValue,
    }))
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
    expect(dbChainMockFns.for).toHaveBeenCalledWith('key share')
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
    const secretProvenance = {
      complete: true,
      columns: {
        'second-output': { version: 1 as const, complete: true, entries: [] },
      },
    }
    await expect(
      writeWorkflowGroupState(CONTEXT, {
        executionState: RUNNING_STATE,
        dataPatch: { 'second-output': 'second' },
        secretProvenance,
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
        /** A cell result carries no acting person down to the write layer. */
        capabilityGovernedUserId: null,
        secretProvenance,
      },
      TABLE,
      CONTEXT.requestId,
      { computedWrite: true }
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

  it('emits the stored option id for a select column, not the raw workflow value', async () => {
    // The workflow returns the option *name*; storage keys on the option id.
    // Emitting the raw name would make the grid resolve it as an id, find
    // nothing, and render the cell empty until the next refetch.
    const dataPatch = { 'status-output': 'Open' }
    await expect(
      writeWorkflowGroupState(CONTEXT, { executionState: RUNNING_STATE, dataPatch })
    ).resolves.toBe('wrote')

    expect(mockAppendTableEvent).toHaveBeenCalledWith(
      expect.objectContaining({ outputs: { 'status-output': 'opt_open' } })
    )
    // The patch object feeds the progress writer's identity-compared retry
    // bookkeeping, so it must survive untouched.
    expect(dataPatch).toEqual({ 'status-output': 'Open' })
  })

  it('resolves select values in a cumulative event snapshot with no data patch', async () => {
    await expect(
      writeWorkflowGroupState(CONTEXT, {
        executionState: RUNNING_STATE,
        eventOutputs: { 'first-output': 'first', 'status-output': 'Closed' },
      })
    ).resolves.toBe('wrote')

    expect(mockAppendTableEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        outputs: { 'first-output': 'first', 'status-output': 'opt_closed' },
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

  it('skips a status write when the row was deleted before pickup', async () => {
    resetDbChainMock()
    mockWriteExecutionsPatch.mockResolvedValue('wrote')

    await expect(writeWorkflowGroupState(CONTEXT, { executionState: RUNNING_STATE })).resolves.toBe(
      'skipped'
    )

    expect(mockWriteExecutionsPatch).not.toHaveBeenCalled()
    expect(mockAppendTableEvent).not.toHaveBeenCalled()
  })

  it('skips a data write when the row is deleted during execution', async () => {
    mockUpdateRow.mockRejectedValueOnce(new TableRowNotFoundError())

    await expect(
      writeWorkflowGroupState(CONTEXT, {
        executionState: RUNNING_STATE,
        dataPatch: { 'first-output': 'late' },
      })
    ).resolves.toBe('skipped')

    expect(mockAppendTableEvent).not.toHaveBeenCalled()
  })

  it('still throws unrelated data-write failures', async () => {
    mockUpdateRow.mockRejectedValueOnce(new Error('database unavailable'))

    await expect(
      writeWorkflowGroupState(CONTEXT, {
        executionState: RUNNING_STATE,
        dataPatch: { 'first-output': 'late' },
      })
    ).rejects.toThrow('database unavailable')
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
        secretProvenance: { complete: false, columns: {} },
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
        secretProvenance: { complete: false, columns: {} },
        runningBlockIds: [],
        blockErrors: {},
      },
    ])
    expect(progress.getPendingDataPatch()).toEqual({})
    expect(progress.getEventOutputs()).toEqual({
      'first-output': 'first',
      'second-output': 'second',
    })
    expect(progress.getPendingSecretProvenance()).toEqual({ complete: true, columns: {} })

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
      secretProvenance: { complete: false, columns: {} },
      runningBlockIds: ['block-2'],
      blockErrors: {},
    })
    expect(progress.getPendingDataPatch()).toEqual({})

    await progress.finish()
  })

  it('persists only the secret provenance present in each mapped output cell', async () => {
    const writeProgress = vi.fn().mockResolvedValue('wrote')
    const progress = createWorkflowCellProgressWriter({
      group: GROUP,
      writeProgress,
      onWriteError: vi.fn(),
    })

    await progress.onBlockComplete('block-1', {
      output: { value: 'secret-value' },
      resolvedSecretTraceProvenance: {
        version: 1,
        complete: true,
        entries: [{ name: 'API_KEY', encryptedValue: 'encrypted-secret' }],
        scope: { userId: 'user-1', workspaceId: 'workspace-1' },
      },
    })
    await progress.waitForPendingWrites()

    expect(writeProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        dataPatch: { 'first-output': 'secret-value' },
        secretProvenance: {
          complete: true,
          columns: {
            'first-output': {
              version: 1,
              complete: true,
              entries: [{ name: 'API_KEY', encryptedValue: 'encrypted-secret' }],
              scope: { userId: 'user-1', workspaceId: 'workspace-1' },
            },
          },
        },
      })
    )
  })

  it('certifies a current exact-empty callback but keeps a legacy callback unknown', async () => {
    const writeProgress = vi.fn().mockResolvedValue('wrote')
    const progress = createWorkflowCellProgressWriter({
      group: GROUP,
      writeProgress,
      onWriteError: vi.fn(),
    })

    await progress.onBlockComplete('block-1', {
      output: { value: 'public' },
      resolvedSecretTraceProvenance: {
        version: 1,
        complete: true,
        entries: [],
        scope: { userId: 'user-1', workspaceId: 'workspace-1' },
      },
    })
    await progress.onBlockComplete('block-2', { output: { value: 'legacy-public' } })
    await progress.waitForPendingWrites()

    expect(writeProgress).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        secretProvenance: {
          complete: true,
          columns: {
            'first-output': {
              version: 1,
              complete: true,
              entries: [],
              scope: { userId: 'user-1', workspaceId: 'workspace-1' },
            },
          },
        },
      })
    )
    expect(writeProgress).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        secretProvenance: { complete: false, columns: {} },
      })
    )
  })
})
