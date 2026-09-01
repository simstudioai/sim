/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getTableById: vi.fn(),
  insertDispatch: vi.fn(async () => 'tdsp_1'),
  readDispatch: vi.fn(async () => null),
  cancelDispatchById: vi.fn(),
  bulkClearWorkflowGroupCells: vi.fn(async () => false),
  runDispatcherToCompletion: vi.fn(),
  resolveTableDispatchConcurrency: vi.fn(async () => 5),
}))

vi.mock('@/lib/table/service', () => ({ getTableById: mocks.getTableById }))
vi.mock('@/lib/table/dispatcher', () => ({
  bulkClearWorkflowGroupCells: mocks.bulkClearWorkflowGroupCells,
  cancelDispatchById: mocks.cancelDispatchById,
  insertDispatch: mocks.insertDispatch,
  readDispatch: mocks.readDispatch,
  runDispatcherToCompletion: mocks.runDispatcherToCompletion,
}))
vi.mock('@/lib/table/dispatch-concurrency', () => ({
  resolveTableDispatchConcurrency: mocks.resolveTableDispatchConcurrency,
}))

import { runWorkflowColumn } from '@/lib/table/workflow-columns'

const TABLE = {
  id: 'table-1',
  workspaceId: 'workspace-1',
  schema: { columns: [], workflowGroups: [{ id: 'group-1', outputs: [] }] },
}

const BASE = {
  tableId: 'table-1',
  workspaceId: 'workspace-1',
  groupIds: ['group-1'],
  mode: 'new' as const,
  isManualRun: false,
  requestId: 'req-1',
}

/** The dispatch row `runWorkflowColumn` asked the dispatcher to insert. */
function inserted(): Record<string, unknown> {
  expect(mocks.insertDispatch).toHaveBeenCalledTimes(1)
  return mocks.insertDispatch.mock.calls[0][0] as Record<string, unknown>
}

describe('runWorkflowColumn governed subject', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getTableById.mockResolvedValue(TABLE)
    mocks.insertDispatch.mockResolvedValue('tdsp_1')
    mocks.readDispatch.mockResolvedValue(null)
    mocks.bulkClearWorkflowGroupCells.mockResolvedValue(false)
    mocks.resolveTableDispatchConcurrency.mockResolvedValue(5)
  })

  /**
   * The row-write auto-fire case: a workspace API key wrote the row, so the
   * attribution names the workspace billed account. Forwarding that as the gate
   * subject — which an optional field with a fallback did — puts a bystander's
   * tool denylist on a run nobody governs.
   */
  it('forwards an explicit null past a non-null attribution', async () => {
    await runWorkflowColumn({
      ...BASE,
      triggeredByUserId: 'billing-owner',
      capabilityGovernedUserId: null,
    })
    const row = inserted()
    expect(row.triggeredByUserId).toBe('billing-owner')
    expect(row.capabilityGovernedUserId).toBeNull()
  })

  it('forwards the acting person for a session-initiated run', async () => {
    await runWorkflowColumn({
      ...BASE,
      triggeredByUserId: 'user-1',
      capabilityGovernedUserId: 'user-1',
    })
    expect(inserted().capabilityGovernedUserId).toBe('user-1')
  })
})
