/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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
  /**
   * `buildEnqueueItems` resolves the cell task with a dynamic import of
   * `@/background/workflow-column-execution` — the largest graph this step
   * touches, and one none of this file's mocks intercept. Under a loaded
   * parallel run that first resolution costs whole seconds, which is why the
   * only test here needed a 20s budget to hold. Warm it once, outside any
   * per-test budget, so the test measures the pre-stamp rather than a module
   * load.
   */
  beforeAll(async () => {
    await Promise.all([
      import('@/background/workflow-column-execution'),
      import('@/lib/table/workflow-columns'),
    ])
  }, 60_000)

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
  })
})
