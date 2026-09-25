import { resetDbChainMock } from '@sim/testing'
import {
  executeWorkflowMock,
  executeWorkflowMockFns,
} from '@sim/testing/mocks/execute-workflow.mock'
import { tableEventsMock } from '@sim/testing/mocks/table-events.mock'
import {
  tableRowsServiceMock,
  tableRowsServiceMockFns,
} from '@sim/testing/mocks/table-rows-service.mock'
import { tableServiceMock, tableServiceMockFns } from '@sim/testing/mocks/table-service.mock'
import {
  tableWorkflowColumnsMock,
  tableWorkflowColumnsMockFns,
} from '@sim/testing/mocks/table-workflow-columns.mock'
import {
  workflowsPersistenceUtilsMock,
  workflowsPersistenceUtilsMockFns,
} from '@sim/testing/mocks/workflows-persistence-utils.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readDispatch: vi.fn(),
  writeWorkflowGroupState: vi.fn(),
  markWorkflowGroupPickedUp: vi.fn(),
  createWorkflowCellProgressWriter: vi.fn(),
  classifyWorkflowCellTerminalResult: vi.fn(),
}))

vi.mock('@/lib/table/dispatcher', () => ({
  readDispatch: mocks.readDispatch,
  completeDispatchIfActive: vi.fn(),
}))
vi.mock('@/lib/table/service', () => tableServiceMock)
vi.mock('@/lib/table/rows/service', () => tableRowsServiceMock)
vi.mock('@/lib/workflows/executor/execute-workflow', () => executeWorkflowMock)
vi.mock('@/lib/workflows/persistence/utils', () => workflowsPersistenceUtilsMock)
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
vi.mock('@/lib/table/workflow-columns', () => tableWorkflowColumnsMock)
vi.mock('@/lib/table/events', () => tableEventsMock)

import { runRowCascadeLoop } from '@/background/workflow-column-execution'

const { mockGetRowById } = tableRowsServiceMockFns
const { mockExecuteWorkflow } = executeWorkflowMockFns
const { mockPickNextEligibleGroupForRow, mockStashCellContextForResume } =
  tableWorkflowColumnsMockFns

const mockGetTableById = tableServiceMockFns.mockGetTableById
const mockLoadDeployedWorkflowState = workflowsPersistenceUtilsMockFns.mockLoadDeployedWorkflowState

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
    resetDbChainMock()
    mockGetTableById.mockResolvedValue(TABLE)
    mockGetRowById.mockResolvedValue({ id: 'row-1', data: {}, executions: {} })
    mockPickNextEligibleGroupForRow.mockReturnValue(null)
    mocks.writeWorkflowGroupState.mockResolvedValue('wrote')
    mocks.markWorkflowGroupPickedUp.mockResolvedValue('picked-up')
    mockLoadDeployedWorkflowState.mockResolvedValue(null)
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
    expect(mockExecuteWorkflow).not.toHaveBeenCalled()
    expect(mocks.markWorkflowGroupPickedUp).not.toHaveBeenCalled()
    expect(mocks.writeWorkflowGroupState).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        executionState: expect.objectContaining({ status: 'cancelled' }),
      })
    )
  })
})
