/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnqueueOutboxEvent } = vi.hoisted(() => ({
  mockEnqueueOutboxEvent: vi.fn(),
}))

vi.mock('@sim/db', () => dbChainMock)
vi.mock('@/lib/billing/storage/payer-transfer', () => ({
  changeOrganizationWorkspaceBilledAccountsInTx: vi.fn(),
  changeWorkspaceStoragePayerInTx: vi.fn(),
  changeWorkspaceStoragePayersInTx: vi.fn(),
}))
vi.mock('@/lib/core/outbox/service', () => ({
  enqueueOutboxEvent: mockEnqueueOutboxEvent,
}))

import { pauseProSubscriptionForOrgCoverage } from '@/lib/billing/organizations/membership'
import { OUTBOX_EVENT_TYPES } from '@/lib/billing/webhooks/outbox-handlers'

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
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('pauses the personal Pro and queues the Stripe sync when an entitled paid org covers the user', async () => {
    queueWhereResponses([
      [ACTIVE_PERSONAL_PRO],
      [{ organizationId: 'org-1' }],
      [{ plan: 'team_6000', referenceId: 'org-1' }],
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
    expect(mockEnqueueOutboxEvent).toHaveBeenCalledWith(
      expect.anything(),
      OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END,
      {
        stripeSubscriptionId: 'stripe-sub-personal',
        subscriptionId: 'sub-personal',
        reason: 'covered-by-organization',
      }
    )
  })

  it('reports not covered when the user has no entitled personal Pro', async () => {
    queueWhereResponses([[]])

    const result = await pauseProSubscriptionForOrgCoverage('user-1')

    expect(result).toEqual({ covered: false, paused: false })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mockEnqueueOutboxEvent).not.toHaveBeenCalled()
  })

  it('reports covered without pausing again when the personal Pro is already pausing', async () => {
    queueWhereResponses([
      [{ ...ACTIVE_PERSONAL_PRO, cancelAtPeriodEnd: true }],
      [{ organizationId: 'org-1' }],
      [{ plan: 'team_6000', referenceId: 'org-1' }],
    ])

    const result = await pauseProSubscriptionForOrgCoverage('user-1')

    expect(result).toEqual({
      covered: true,
      paused: false,
      subscriptionId: 'sub-personal',
      organizationId: 'org-1',
    })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mockEnqueueOutboxEvent).not.toHaveBeenCalled()
  })

  it('reports not covered when the user is not a member of any organization', async () => {
    queueWhereResponses([[ACTIVE_PERSONAL_PRO], []])

    const result = await pauseProSubscriptionForOrgCoverage('user-1')

    expect(result).toEqual({ covered: false, paused: false })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('reports not covered when no org subscription is an entitled paid plan', async () => {
    queueWhereResponses([[ACTIVE_PERSONAL_PRO], [{ organizationId: 'org-1' }], []])

    const result = await pauseProSubscriptionForOrgCoverage('user-1')

    expect(result).toEqual({ covered: false, paused: false })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mockEnqueueOutboxEvent).not.toHaveBeenCalled()
  })
})
