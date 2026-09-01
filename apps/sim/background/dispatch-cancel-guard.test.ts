/**
 * @vitest-environment node
 */
import { resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readDispatch: vi.fn(),
  getTableById: vi.fn(),
  getRowById: vi.fn(),
  executeWorkflow: vi.fn(),
  loadDeployedWorkflowState: vi.fn(),
  writeWorkflowGroupState: vi.fn(),
  markWorkflowGroupPickedUp: vi.fn(),
  createWorkflowCellProgressWriter: vi.fn(),
  pickNextEligibleGroupForRow: vi.fn(),
  stashCellContextForResume: vi.fn(),
  classifyWorkflowCellTerminalResult: vi.fn(),
}))

vi.mock('@/lib/table/dispatcher', () => ({
  readDispatch: mocks.readDispatch,
  completeDispatchIfActive: vi.fn(),
}))
vi.mock('@/lib/table/service', () => ({ getTableById: mocks.getTableById }))
vi.mock('@/lib/table/rows/service', () => ({
  getRowById: mocks.getRowById,
  updateRow: vi.fn(),
}))
vi.mock('@/lib/workflows/executor/execute-workflow', () => ({
  executeWorkflow: mocks.executeWorkflow,
}))
vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadDeployedWorkflowState: mocks.loadDeployedWorkflowState,
}))
vi.mock('@/lib/table/cell-write', () => ({
  buildCancelledExecution: (prev: { executionId: string | null; workflowId: string }) => ({
    status: 'cancelled',
    executionId: prev.executionId,
    jobId: null,
    workflowId: prev.workflowId,
    error: 'Cancelled',
  }),
  createWorkflowCellProgressWriter: mocks.createWorkflowCellProgressWriter,
  writeWorkflowGroupState: mocks.writeWorkflowGroupState,
  markWorkflowGroupPickedUp: mocks.markWorkflowGroupPickedUp,
}))
vi.mock('@/lib/table/workflow-cell-result', () => ({
  classifyWorkflowCellTerminalResult: mocks.classifyWorkflowCellTerminalResult,
}))
vi.mock('@/lib/table/workflow-columns', () => ({
  pickNextEligibleGroupForRow: mocks.pickNextEligibleGroupForRow,
  stashCellContextForResume: mocks.stashCellContextForResume,
}))
vi.mock('@/lib/table/events', () => ({ appendTableEvent: vi.fn() }))

import { runRowCascadeLoop } from '@/background/workflow-column-execution'

const TABLE = {
  id: 'table-1',
  name: 'Table',
  workspaceId: 'workspace-1',
  schema: {
    columns: [],
    workflowGroups: [{ id: 'group-1', workflowId: 'workflow-1', outputs: [] }],
  },
}

const PAYLOAD = {
  tableId: 'table-1',
  tableName: 'Table',
  rowId: 'row-1',
  groupId: 'group-1',
  workflowId: 'workflow-1',
  workspaceId: 'workspace-1',
  executionId: 'execution-1',
  dispatchId: 'tdsp_1',
  executionTimeoutMs: 10_000,
  billingAttribution: {
    actorUserId: 'user-1',
    workspaceId: 'workspace-1',
    organizationId: null,
    billedAccountUserId: 'user-1',
    billingEntity: { type: 'user' as const, id: 'user-1' },
    billingPeriod: { start: '2026-07-01T00:00:00.000Z', end: '2026-08-01T00:00:00.000Z' },
    payerSubscription: null,
  },
} as Parameters<typeof runRowCascadeLoop>[0]

describe('the cell guard on its owning dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.getTableById.mockResolvedValue(TABLE)
    mocks.getRowById.mockResolvedValue({ id: 'row-1', data: {}, executions: {} })
    mocks.pickNextEligibleGroupForRow.mockReturnValue(null)
    mocks.writeWorkflowGroupState.mockResolvedValue('wrote')
    mocks.markWorkflowGroupPickedUp.mockResolvedValue('picked-up')
    mocks.loadDeployedWorkflowState.mockResolvedValue(null)
  })

  /**
   * The dispatcher blocks on a whole window, so cancelling its row — which is
   * all account deletion does before the user row goes away — leaves the cells
   * that window already queued free to invoke tools and write results.
   */
  it('refuses to execute a cell whose dispatch was cancelled', async () => {
    mocks.readDispatch.mockResolvedValue({ id: 'tdsp_1', status: 'cancelled' })

    await runRowCascadeLoop(PAYLOAD)

    expect(mocks.readDispatch).toHaveBeenCalledWith('tdsp_1')
    expect(mocks.executeWorkflow).not.toHaveBeenCalled()
    expect(mocks.markWorkflowGroupPickedUp).not.toHaveBeenCalled()
    expect(mocks.writeWorkflowGroupState).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        executionState: expect.objectContaining({ status: 'cancelled' }),
      })
    )
  })

  /**
   * `complete` is the ordinary state a dispatch reaches while its final window
   * is still finishing — stopping on it would kill the run's last cells.
   */
  it('lets a cell of a still-live dispatch past the guard', async () => {
    mocks.readDispatch.mockResolvedValue({ id: 'tdsp_1', status: 'complete' })

    await runRowCascadeLoop(PAYLOAD)

    // It got as far as loading the workflow, which the db mock does not have.
    const statuses = mocks.writeWorkflowGroupState.mock.calls.map(
      ([, write]) => (write as { executionState: { status: string } }).executionState.status
    )
    expect(statuses).toContain('error')
    expect(statuses).not.toContain('cancelled')
  })
})
