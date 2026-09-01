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

describe('deleteUserAccount and the governed-subject foreign key', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockIsSoleOwnerOfPaidOrganization.mockResolvedValue({ isSoleOwner: false, name: null })
    mockGetPersonalSubscription.mockResolvedValue(null)
    mockIsUsingCloudStorage.mockReturnValue(false)
  })

  /**
   * `capability_governed_user_id` is `ON DELETE SET NULL`, and a subject the
   * database erased reads exactly like a run that never had one — so a dispatch
   * that outlived its governor would keep executing its remaining windows with
   * no per-tool gate at all. The in-process dispatcher has no time ceiling, so
   * that is not a short window. Going terminal first is what keeps the nulled
   * row unreachable.
   */
  it('cancels the account’s still-queued dispatches before deleting the user row', async () => {
    await deleteUserAccount('user-1')

    expect(dbChainMockFns.update).toHaveBeenCalledWith(schemaMock.tableRunDispatches)
    const cancelled = dbChainMockFns.set.mock.calls.find(
      ([patch]) => (patch as { status?: string }).status === 'cancelled'
    )
    expect(cancelled).toBeDefined()
    expect((cancelled?.[0] as { cancelledAt?: Date }).cancelledAt).toBeInstanceOf(Date)
    expect(dbChainMockFns.delete).toHaveBeenCalledWith(schemaMock.user)
  })

  /**
   * The subject, not the attribution: `triggered_by_user_id` names the workspace
   * billed account when the run's credential named no human, so cancelling on it
   * would stop a workspace-key run this account never governed and leave the
   * account's own actorless-looking rows alive.
   */
  it('cancels on the governed subject and only the still-active statuses', async () => {
    await deleteUserAccount('user-1')

    const filter = dbChainMockFns.where.mock.calls
      .map(([condition]) => condition)
      .find((condition) =>
        hasMockCondition(
          condition,
          (node) => node.left === schemaMock.tableRunDispatches.capabilityGovernedUserId
        )
      )
    expect(filter).toBeDefined()
    expect(hasMockCondition(filter, (node) => node.type === 'eq' && node.right === 'user-1')).toBe(
      true
    )
    expect(
      hasMockCondition(
        filter,
        (node) =>
          node.type === 'inArray' &&
          node.column === schemaMock.tableRunDispatches.status &&
          Array.isArray(node.values) &&
          node.values.join(',') === 'pending,dispatching'
      )
    ).toBe(true)
  })

  /** The cancel must precede the delete, or the FK has already nulled the subject. */
  it('orders the cancel ahead of the user delete', async () => {
    await deleteUserAccount('user-1')

    const cancelOrder = dbChainMockFns.update.mock.invocationCallOrder.at(-1)
    const deleteOrder = dbChainMockFns.delete.mock.invocationCallOrder.at(-1)
    expect(cancelOrder).toBeDefined()
    expect(deleteOrder).toBeDefined()
    expect(cancelOrder as number).toBeLessThan(deleteOrder as number)
  })
})
