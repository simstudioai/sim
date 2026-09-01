/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getTableById: vi.fn(),
  writeWorkflowGroupState: vi.fn(),
  batchEnqueueAndWait: vi.fn(),
}))

vi.mock('@/lib/table/events', () => ({ appendTableEvent: vi.fn() }))
vi.mock('@/lib/table/service', () => ({ getTableById: mocks.getTableById }))
vi.mock('@/lib/table/cell-write', () => ({
  writeWorkflowGroupState: mocks.writeWorkflowGroupState,
}))
vi.mock('@/lib/billing/core/billing-attribution', () => ({
  assertBillingAttributionSnapshot: (snapshot: unknown) => snapshot,
  resolveBillingAttribution: async () => ({ actorUserId: 'billing-owner' }),
  resolveSystemBillingAttribution: async () => ({ actorUserId: null }),
}))
vi.mock('@/lib/core/async-jobs/config', () => ({
  getJobQueue: async () => ({ batchEnqueueAndWait: mocks.batchEnqueueAndWait }),
}))

import { dispatcherStep } from '@/lib/table/dispatcher'

const GROUP = { id: 'group-1', workflowId: 'workflow-1', outputs: [] }

const DISPATCH = {
  id: 'tdsp_1',
  tableId: 'table-1',
  workspaceId: 'workspace-1',
  requestId: 'req-1',
  mode: 'incomplete',
  scope: { groupIds: ['group-1'] },
  status: 'dispatching',
  cursor: -1,
  limit: null,
  processedCount: 0,
  isManualRun: true,
  triggeredByUserId: 'billing-owner',
  capabilityGovernedUserId: 'requesting-member',
  requestedAt: new Date('2026-08-21T15:00:00.000Z'),
  completedAt: null,
  cancelledAt: null,
}

describe('the dispatcher pre-stamp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.getTableById.mockResolvedValue({
      id: 'table-1',
      workspaceId: 'workspace-1',
      schema: { columns: [], workflowGroups: [GROUP] },
    })
    mocks.writeWorkflowGroupState.mockResolvedValue('wrote')
    dbChainMockFns.limit
      .mockResolvedValueOnce([DISPATCH])
      .mockResolvedValueOnce([{ id: 'row-1', tableId: 'table-1', position: 0, data: {} }])
      .mockResolvedValueOnce([DISPATCH])
  })

  /**
   * The marker outlives its own worker: a cell task that finds the row's
   * cascade lock held bails, and the lock owner drains the marker. Without the
   * subject on the stamp, that drain runs the request under the owner's
   * subject — a different dispatch, often an ungated auto-fire.
   */
  it('stamps the dispatch’s governed subject onto every cell it queues', async () => {
    await dispatcherStep('tdsp_1')

    expect(mocks.writeWorkflowGroupState).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        executionState: expect.objectContaining({
          status: 'pending',
          capabilityGovernedUserId: 'requesting-member',
        }),
      })
    )
  }, 20_000)
})
