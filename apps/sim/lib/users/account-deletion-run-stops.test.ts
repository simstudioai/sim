import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { billingPlanMock, billingPlanMockFns } from '@sim/testing/mocks/billing-plan.mock'
import {
  mothershipAgentUrlMock,
  mothershipAgentUrlMockFns,
} from '@sim/testing/mocks/mothership-agent-url.mock'
import {
  organizationMembershipMock,
  organizationMembershipMockFns,
} from '@sim/testing/mocks/organization-membership.mock'
import { storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import { tableEventsMock, tableEventsMockFns } from '@sim/testing/mocks/table-events.mock'
import { uploadsMock, uploadsMockFns } from '@sim/testing/mocks/uploads.mock'
import { workspacesUtilsMock } from '@sim/testing/mocks/workspaces-utils.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/billing/organizations/membership', () => organizationMembershipMock)
vi.mock('@/lib/billing/core/plan', () => billingPlanMock)
vi.mock('@/lib/uploads', () => uploadsMock)
vi.mock('@/lib/workspaces/utils', () => workspacesUtilsMock)
vi.mock('@/lib/table/events', () => tableEventsMock)
vi.mock('@/lib/mothership/server/agent-url', () => mothershipAgentUrlMock)

import { deleteUserAccount } from '@/lib/users/account-deletion'

describe('stopping a deleted account’s Chat runs', () => {
  beforeEach(() => {
    resetDbChainMock()
    organizationMembershipMockFns.mockIsSoleOwnerOfPaidOrganization.mockResolvedValue({
      isSoleOwner: false,
      name: null,
    })
    billingPlanMockFns.mockGetHighestPriorityPersonalSubscription.mockResolvedValue(null)
    uploadsMockFns.mockIsUsingCloudStorage.mockReturnValue(false)
    storageServiceMockFns.mockDeleteFiles.mockResolvedValue({ failed: [] })
    tableEventsMockFns.mockAppendTableEvent.mockResolvedValue(null)
  })

  /**
   * The worker endpoint only routes the best-effort Stop push; run control answers Stop for
   * the erased account either way, so the erasure must not depend on reading it.
   */
  it('still erases the account when the run-routing lookup fails', async () => {
    mothershipAgentUrlMockFns.mockGetMothershipBaseURL.mockRejectedValueOnce(
      new Error('settings unavailable')
    )

    await expect(deleteUserAccount('user-1', { recordIdentity: false })).resolves.toBeDefined()
    expect(dbChainMockFns.transaction).toHaveBeenCalled()
  })
})
