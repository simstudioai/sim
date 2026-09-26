import { billingUsageMock, billingUsageMockFns } from '@sim/testing/mocks/billing-usage.mock'
import {
  organizationMembershipMock,
  organizationMembershipMockFns,
} from '@sim/testing/mocks/organization-membership.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/billing/organizations/membership', () => organizationMembershipMock)
vi.mock('@/lib/billing/core/usage', () => billingUsageMock)

import { membershipBillingOutboxHandlers } from '@/lib/billing/organizations/membership-reconciliation'

const mocks = {
  restore: organizationMembershipMockFns.mockRestoreUserProSubscription,
  syncLimits: billingUsageMockFns.mockSyncUsageLimitsFromSubscription,
}

describe('member billing reconciliation outbox', () => {
  it('restores personal Pro before deriving the departed user limit', async () => {
    const handler = membershipBillingOutboxHandlers['billing.reconcile-member-after-org-leave']
    await handler(
      { userId: 'user-1', organizationId: 'org-1' },
      {
        eventId: 'event-1',
        eventType: 'billing.reconcile-member-after-org-leave',
        attempts: 0,
        checkpointPayload: vi.fn(),
      }
    )

    expect(mocks.restore).toHaveBeenCalledWith('user-1')
    expect(mocks.syncLimits).toHaveBeenCalledWith('user-1')
    expect(mocks.restore.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.syncLimits.mock.invocationCallOrder[0]
    )
  })
})
