import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { billingSubscriptionSyncMock } from '@sim/testing/mocks/billing-subscription-sync.mock'
import { outboxServiceMock } from '@sim/testing/mocks/outbox-service.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/billing/storage/payer-transfer', () => ({
  changeOrganizationWorkspaceBilledAccountsInTx: vi.fn(),
  changeWorkspaceStoragePayerInTx: vi.fn(),
  changeWorkspaceStoragePayersInTx: vi.fn(),
}))
vi.mock('@/lib/core/outbox/service', () => outboxServiceMock)
vi.mock('@/lib/billing/webhooks/subscription-sync', () => billingSubscriptionSyncMock)

import { pauseProSubscriptionForOrgCoverage } from '@/lib/billing/organizations/membership'

const ACTIVE_PERSONAL_PRO = {
  id: 'sub-personal',
  plan: 'pro_6000',
  referenceId: 'user-1',
  status: 'active',
  cancelAtPeriodEnd: false,
  stripeSubscriptionId: 'stripe-sub-personal',
}

/**
 * Queues per-`where()` results for the three reads in the pause path:
 * personal sub (`.for('update').limit(1)`), memberships (awaited where),
 * and org subscriptions (awaited where).
 */
function queueWhereResponses(responses: unknown[][]) {
  const queue = [...responses]
  dbChainMockFns.where.mockImplementation(() => {
    const result = queue.shift() ?? []
    const limit = vi.fn(() => Promise.resolve(result))
    const forResult = Promise.resolve(result) as Promise<unknown[]> & { limit: typeof limit }
    forResult.limit = limit
    const thenable = Promise.resolve(result) as Promise<unknown[]> & {
      limit: typeof limit
      for: () => typeof forResult
    }
    thenable.limit = limit
    thenable.for = vi.fn(() => forResult)
    return thenable as ReturnType<typeof dbChainMockFns.where>
  })
}

describe('pauseProSubscriptionForOrgCoverage', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it('pauses the personal Pro when an entitled paid org covers the user', async () => {
    queueWhereResponses([
      [{ organizationId: 'org-1' }],
      [{ plan: 'team_6000', referenceId: 'org-1' }],
      [ACTIVE_PERSONAL_PRO],
      // update ... set ... where consumes one more where() call
      [],
    ])

    const result = await pauseProSubscriptionForOrgCoverage('user-1')

    expect(result).toEqual({
      covered: true,
      paused: true,
      subscriptionId: 'sub-personal',
      organizationId: 'org-1',
    })
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ cancelAtPeriodEnd: true })
  })

  it('reports covered even when no entitled personal Pro row exists', async () => {
    queueWhereResponses([
      [{ organizationId: 'org-1' }],
      [{ plan: 'team_6000', referenceId: 'org-1' }],
      [],
    ])

    const result = await pauseProSubscriptionForOrgCoverage('user-1')

    expect(result).toEqual({
      covered: true,
      paused: false,
      organizationId: 'org-1',
    })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('reports covered without pausing again when the personal Pro is already pausing', async () => {
    queueWhereResponses([
      [{ organizationId: 'org-1' }],
      [{ plan: 'team_6000', referenceId: 'org-1' }],
      [{ ...ACTIVE_PERSONAL_PRO, cancelAtPeriodEnd: true }],
    ])

    const result = await pauseProSubscriptionForOrgCoverage('user-1')

    expect(result).toEqual({
      covered: true,
      paused: false,
      subscriptionId: 'sub-personal',
      organizationId: 'org-1',
    })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
})
