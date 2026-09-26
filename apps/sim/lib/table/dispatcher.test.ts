import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { tableEventsMock, tableEventsMockFns } from '@sim/testing/mocks/table-events.mock'
import { tableServiceMock, tableServiceMockFns } from '@sim/testing/mocks/table-service.mock'
import {
  tableWorkflowColumnsMock,
  tableWorkflowColumnsMockFns,
} from '@sim/testing/mocks/table-workflow-columns.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockBatchEnqueueAndWait, mockWriteWorkflowGroupState } = vi.hoisted(() => ({
  mockBatchEnqueueAndWait: vi.fn(),
  mockWriteWorkflowGroupState: vi.fn(),
}))

vi.mock('@/lib/table/events', () => tableEventsMock)
vi.mock('@/lib/table/service', () => tableServiceMock)
vi.mock('@/lib/table/cell-write', () => ({ writeWorkflowGroupState: mockWriteWorkflowGroupState }))
vi.mock('@/lib/core/async-jobs/config', () => ({
  getJobQueue: async () => ({ batchEnqueueAndWait: mockBatchEnqueueAndWait }),
}))
vi.mock('@/lib/table/workflow-columns', () => tableWorkflowColumnsMock)

import { dispatcherStep } from '@/lib/table/dispatcher'

tableWorkflowColumnsMockFns.mockBuildEnqueueItems.mockImplementation(async (runs: unknown[]) =>
  runs.map((payload) => ({ payload }))
)
/** Every targeted group of every row is eligible, so cells = rows × groups. */
tableWorkflowColumnsMockFns.mockBuildPendingRuns.mockImplementation(
  (
    table: { id: string; name: string; workspaceId: string },
    rows: Array<{ id: string }>,
    opts?: { groupIds?: string[] }
  ) =>
    rows.flatMap((row) =>
      (opts?.groupIds ?? []).map((groupId) => ({
        tableId: table.id,
        tableName: table.name,
        rowId: row.id,
        groupId,
        workflowId: 'workflow-1',
        workspaceId: table.workspaceId,
        executionId: `exec-${row.id}-${groupId}`,
      }))
    )
)

const mockAppendTableEvent = tableEventsMockFns.mockAppendTableEvent
const mockGetTableById = tableServiceMockFns.mockGetTableById

const DISPATCH = {
  id: 'tdsp_1',
  tableId: 'table-1',
  workspaceId: 'workspace-1',
  requestId: 'req-1',
  mode: 'all',
  scope: { groupIds: ['group-1'] },
  status: 'dispatching',
  cursor: 0,
  limit: null,
  processedCount: 0,
  isManualRun: true,
  triggeredByUserId: 'user-1',
  requestedAt: new Date('2026-08-21T15:00:00.000Z'),
  completedAt: null,
  cancelledAt: null,
}

const TABLE = {
  id: 'table-1',
  name: 'People',
  workspaceId: 'workspace-1',
  schema: { columns: [], workflowGroups: [{ id: 'group-1' }, { id: 'group-2' }] },
}

const ROWS = [
  {
    id: 'row-1',
    tableId: 'table-1',
    position: 1,
    data: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'row-2',
    tableId: 'table-1',
    position: 2,
    data: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  },
]

/**
 * The delta `incrementProcessedCount` bound into its `processedCount + n`
 * fragment, or null when the step never bumped the counter. The `sql` mock
 * keeps the interpolated values, so the delta is the fragment's only number.
 */
function processedCountDelta(): number | null {
  const call = dbChainMockFns.set.mock.calls.find(
    ([values]) => (values as Record<string, unknown> | undefined)?.processedCount !== undefined
  )
  if (!call) return null
  const fragment = (call[0] as { processedCount: { values: unknown[] } }).processedCount
  return fragment.values.find((value): value is number => typeof value === 'number') ?? null
}

/** One dispatching step whose window holds `ROWS`; every re-read sees the same dispatch. */
function arrangeWindow(dispatch: typeof DISPATCH): void {
  mockGetTableById.mockResolvedValue(TABLE)
  dbChainMockFns.limit
    .mockResolvedValueOnce([dispatch])
    .mockResolvedValueOnce(ROWS)
    .mockResolvedValue([dispatch])
}

describe('dispatcherStep processedCount', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockBatchEnqueueAndWait.mockResolvedValue(undefined)
    mockWriteWorkflowGroupState.mockResolvedValue(undefined)
  })

  it('counts distinct rows, not cells, when several groups are targeted', async () => {
    arrangeWindow({ ...DISPATCH, scope: { groupIds: ['group-1', 'group-2'] } })

    await dispatcherStep('tdsp_1')

    expect(mockBatchEnqueueAndWait.mock.calls[0][1]).toHaveLength(4)
    expect(processedCountDelta()).toBe(2)
  })

  it('still counts under a row cap the window does not exhaust', async () => {
    arrangeWindow({ ...DISPATCH, limit: { type: 'rows', max: 5 } })

    const result = await dispatcherStep('tdsp_1')

    expect(result).toBe('continue')
    expect(processedCountDelta()).toBe(2)
  })

  it('does not count rows whose enqueue failed', async () => {
    arrangeWindow(DISPATCH)
    mockBatchEnqueueAndWait.mockRejectedValueOnce(new Error('queue unavailable'))

    await dispatcherStep('tdsp_1')

    expect(processedCountDelta()).toBeNull()
  })
})
