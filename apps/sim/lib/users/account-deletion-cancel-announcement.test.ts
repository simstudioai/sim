import { dbChainMockFns, resetDbChainMock, schemaMock } from '@sim/testing'
import { billingPlanMock, billingPlanMockFns } from '@sim/testing/mocks/billing-plan.mock'
import {
  organizationMembershipMock,
  organizationMembershipMockFns,
} from '@sim/testing/mocks/organization-membership.mock'
import { storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import { tableEventsMock, tableEventsMockFns } from '@sim/testing/mocks/table-events.mock'
import { uploadsMock, uploadsMockFns } from '@sim/testing/mocks/uploads.mock'
import { workspacesUtilsMock } from '@sim/testing/mocks/workspaces-utils.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = {
  getPersonalSubscription: billingPlanMockFns.mockGetHighestPriorityPersonalSubscription,
  isSoleOwnerOfPaidOrganization: organizationMembershipMockFns.mockIsSoleOwnerOfPaidOrganization,
  isUsingCloudStorage: uploadsMockFns.mockIsUsingCloudStorage,
  appendTableEvent: tableEventsMockFns.mockAppendTableEvent,
}

vi.mock('@/lib/billing/organizations/membership', () => organizationMembershipMock)
vi.mock('@/lib/billing/core/plan', () => billingPlanMock)
vi.mock('@/lib/uploads', () => uploadsMock)
vi.mock('@/lib/workspaces/utils', () => workspacesUtilsMock)
vi.mock('@/lib/table/events', () => tableEventsMock)

import { deleteUserAccount } from '@/lib/users/account-deletion'

const DISPATCH_ROWS = [
  {
    id: 'tdsp_1',
    tableId: 'table-1',
    scope: { groupIds: ['group-1'] },
    cursor: 4,
    mode: 'all',
    isManualRun: true,
  },
]
const MARKER_ROWS = [{ tableId: 'table-1', rowId: 'row-1', groupId: 'group-2' }]

describe('announcing the work a deleted account’s cancels stopped', () => {
  beforeEach(() => {
    resetDbChainMock()
    mocks.isSoleOwnerOfPaidOrganization.mockResolvedValue({ isSoleOwner: false, name: null })
    mocks.getPersonalSubscription.mockResolvedValue(null)
    mocks.isUsingCloudStorage.mockReturnValue(false)
    storageServiceMockFns.mockDeleteFiles.mockResolvedValue({ failed: [] })
    mocks.appendTableEvent.mockResolvedValue(null)
    // The two cancels are the only `.returning()` reads this teardown makes: no
    // workspace is doomed, so the workspace-delete block never runs.
    dbChainMockFns.returning.mockResolvedValueOnce(DISPATCH_ROWS).mockResolvedValueOnce(MARKER_ROWS)
  })

  /**
   * These writes bypass the ordinary cancel path, which is what publishes the
   * terminal events. Without them a collaborator in a surviving workspace keeps
   * watching a dispatch that will never advance, and cells stay on their
   * in-flight pill until something unrelated touches the row.
   */
  it('publishes the same terminal dispatch and cell events a Stop would', async () => {
    await deleteUserAccount('user-1')

    expect(mocks.appendTableEvent).toHaveBeenCalledWith({
      kind: 'dispatch',
      tableId: 'table-1',
      dispatchId: 'tdsp_1',
      status: 'cancelled',
      scope: { groupIds: ['group-1'] },
      cursor: 4,
      mode: 'all',
      isManualRun: true,
    })
    expect(mocks.appendTableEvent).toHaveBeenCalledWith({
      kind: 'cell',
      tableId: 'table-1',
      rowId: 'row-1',
      groupId: 'group-2',
      status: 'cancelled',
      executionId: null,
      jobId: null,
      error: 'Cancelled',
    })
  })

  /**
   * The event log is not transactional, so an event published inside the
   * transaction would announce a cancellation a rollback then undoes.
   */
  it('publishes nothing when the teardown is rolled back', async () => {
    dbChainMockFns.transaction.mockImplementationOnce(async () => {
      throw new Error('rolled back')
    })

    await expect(deleteUserAccount('user-1')).rejects.toThrow('rolled back')
    expect(mocks.appendTableEvent).not.toHaveBeenCalled()
  })

  /**
   * A dispatcher that read its status as active a moment ago can still stamp a
   * marker. Its insert's foreign key needs a `FOR KEY SHARE` on the departing
   * user's row, which this `FOR UPDATE` conflicts with — so every concurrent
   * stamp either commits before the marker cancel can miss it, or blocks until
   * the `user` delete has landed and is refused outright. Without it a stamp
   * landing between the cancel and the delete is nulled by `ON DELETE SET NULL`
   * and drained by a sibling worker as actorless.
   */
  it('locks the departing user’s row before cancelling anything it governs', async () => {
    await deleteUserAccount('user-1')

    expect(dbChainMockFns.for).toHaveBeenCalledWith('update')
    const lockedAt = Math.min(...dbChainMockFns.for.mock.invocationCallOrder)
    const cancelledAt = Math.min(
      ...dbChainMockFns.update.mock.calls
        .map((call, index) => ({ call, index }))
        .filter(({ call }) => call[0] === schemaMock.tableRunDispatches)
        .map(({ index }) => dbChainMockFns.update.mock.invocationCallOrder[index])
    )
    expect(lockedAt).toBeLessThan(cancelledAt)
  })
})
