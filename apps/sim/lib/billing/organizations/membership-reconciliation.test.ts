/** @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  restore: vi.fn(),
  syncLimits: vi.fn(),
}))

vi.mock('@/lib/billing/organizations/membership', () => ({
  MEMBER_BILLING_RECONCILIATION_EVENT_TYPE: 'billing.reconcile-member-after-org-leave',
  restoreUserProSubscription: mocks.restore,
}))
vi.mock('@/lib/billing/core/usage', () => ({
  syncUsageLimitsFromSubscription: mocks.syncLimits,
}))

import { membershipBillingOutboxHandlers } from '@/lib/billing/organizations/membership-reconciliation'

describe('member billing reconciliation outbox', () => {
  beforeEach(() => vi.clearAllMocks())

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

  it('propagates failures so the generic outbox retries', async () => {
    mocks.restore.mockRejectedValueOnce(new Error('database unavailable'))
    const handler = membershipBillingOutboxHandlers['billing.reconcile-member-after-org-leave']

    await expect(
      handler(
        { userId: 'user-1', organizationId: 'org-1' },
        {
          eventId: 'event-1',
          eventType: 'billing.reconcile-member-after-org-leave',
          attempts: 0,
          checkpointPayload: vi.fn(),
        }
      )
    ).rejects.toThrow('database unavailable')
    expect(mocks.syncLimits).not.toHaveBeenCalled()
  })
})
