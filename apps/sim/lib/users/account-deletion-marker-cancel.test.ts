/**
 * @vitest-environment node
 */
import { dbChainMockFns, hasMockCondition, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsSoleOwnerOfPaidOrganization, mockGetPersonalSubscription, mockIsUsingCloudStorage } =
  vi.hoisted(() => ({
    mockIsSoleOwnerOfPaidOrganization: vi.fn(),
    mockGetPersonalSubscription: vi.fn(),
    mockIsUsingCloudStorage: vi.fn(),
  }))

vi.mock('@/lib/billing/organizations/membership', () => ({
  isSoleOwnerOfPaidOrganization: mockIsSoleOwnerOfPaidOrganization,
}))
vi.mock('@/lib/billing/core/plan', () => ({
  getHighestPriorityPersonalSubscription: mockGetPersonalSubscription,
}))
vi.mock('@/lib/uploads', () => ({
  isUsingCloudStorage: mockIsUsingCloudStorage,
  StorageService: { deleteFiles: vi.fn(async () => ({ failed: [] })) },
}))
vi.mock('@/lib/workspaces/utils', () => ({
  reassignBilledAccountForUser: vi.fn(async () => ({ unresolved: [] })),
  reassignOwnedWorkspacesForUser: vi.fn(async () => ({ unresolved: [] })),
}))

import { deleteUserAccount } from '@/lib/users/account-deletion'

/** The `where` filter of the update that targets `table_row_executions`. */
function markerCancelFilter() {
  return dbChainMockFns.where.mock.calls
    .map(([condition]) => condition)
    .find((condition) =>
      hasMockCondition(
        condition,
        (node) => node.left === schemaMock.tableRowExecutions.capabilityGovernedUserId
      )
    )
}

describe('deleteUserAccount and the account’s pre-stamped cell markers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockIsSoleOwnerOfPaidOrganization.mockResolvedValue({ isSoleOwner: false, name: null })
    mockGetPersonalSubscription.mockResolvedValue(null)
    mockIsUsingCloudStorage.mockReturnValue(false)
  })

  /**
   * Cancelling only the dispatches leaves the markers those dispatches already
   * stamped. A marker is drained by whichever worker holds the row's cascade
   * lock, and that worker's guard consults its OWN dispatch — so an unrelated
   * active dispatch drains the departing account's marker, whose `SET NULL`
   * subject then reads as an actorless run with no per-tool gate.
   */
  it('terminalizes the account’s still-unstarted markers', async () => {
    await deleteUserAccount('user-1')

    expect(dbChainMockFns.update).toHaveBeenCalledWith(schemaMock.tableRowExecutions)
    const filter = markerCancelFilter()
    expect(filter).toBeDefined()
    expect(hasMockCondition(filter, (node) => node.type === 'eq' && node.right === 'user-1')).toBe(
      true
    )
  })

  /** The same terminal state a cancel writes, so every `isExecCancelled` drain
   *  guard already refuses to run it. */
  it('writes the canonical cancelled cell state', async () => {
    await deleteUserAccount('user-1')

    const cancelled = dbChainMockFns.set.mock.calls
      .map(([patch]) => patch as { status?: string; cancelledAt?: Date; error?: string })
      .filter((patch) => patch.status === 'cancelled')
    expect(cancelled.some((patch) => patch.error === 'Cancelled')).toBe(true)
    expect(
      cancelled.every(
        (patch) => patch.cancelledAt === undefined || patch.cancelledAt instanceof Date
      )
    ).toBe(true)
  })

  /** Only the states a marker sits in before a worker claims it. */
  it('leaves running and terminal cells alone', async () => {
    await deleteUserAccount('user-1')

    expect(
      hasMockCondition(
        markerCancelFilter(),
        (node) =>
          node.type === 'inArray' &&
          node.column === schemaMock.tableRowExecutions.status &&
          Array.isArray(node.values) &&
          node.values.join(',') === 'pending,queued'
      )
    ).toBe(true)
  })

  /** After the FK nulls the subject there is nothing left to match on. */
  it('runs before the user row is deleted', async () => {
    await deleteUserAccount('user-1')

    const markerCancelOrder = dbChainMockFns.update.mock.calls.reduce(
      (found, call, index) =>
        call[0] === schemaMock.tableRowExecutions
          ? dbChainMockFns.update.mock.invocationCallOrder[index]
          : found,
      undefined as number | undefined
    )
    const deleteOrder = dbChainMockFns.delete.mock.invocationCallOrder.at(-1)
    expect(markerCancelOrder).toBeDefined()
    expect(markerCancelOrder as number).toBeLessThan(deleteOrder as number)
  })
})
