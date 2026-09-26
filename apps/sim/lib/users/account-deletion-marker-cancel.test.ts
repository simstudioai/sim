import { dbChainMockFns, hasMockCondition, resetDbChainMock, schemaMock } from '@sim/testing'
import { billingPlanMock, billingPlanMockFns } from '@sim/testing/mocks/billing-plan.mock'
import {
  organizationMembershipMock,
  organizationMembershipMockFns,
} from '@sim/testing/mocks/organization-membership.mock'
import { storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import { uploadsMock, uploadsMockFns } from '@sim/testing/mocks/uploads.mock'
import { workspacesUtilsMock } from '@sim/testing/mocks/workspaces-utils.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetPersonalSubscription = billingPlanMockFns.mockGetHighestPriorityPersonalSubscription
const { mockIsSoleOwnerOfPaidOrganization } = organizationMembershipMockFns
const { mockIsUsingCloudStorage } = uploadsMockFns

vi.mock('@/lib/billing/organizations/membership', () => organizationMembershipMock)
vi.mock('@/lib/billing/core/plan', () => billingPlanMock)
vi.mock('@/lib/uploads', () => uploadsMock)
vi.mock('@/lib/workspaces/utils', () => workspacesUtilsMock)

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
    resetDbChainMock()
    mockIsSoleOwnerOfPaidOrganization.mockResolvedValue({ isSoleOwner: false, name: null })
    mockGetPersonalSubscription.mockResolvedValue(null)
    mockIsUsingCloudStorage.mockReturnValue(false)
    storageServiceMockFns.mockDeleteFiles.mockResolvedValue({ failed: [] })
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
