import { dbChainMockFns, resetDbChainMock, resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { asyncJobsMock, asyncJobsMockFns } from '@sim/testing/mocks/async-jobs.mock'
import {
  billingSubscriptionMock,
  billingSubscriptionMockFns,
} from '@sim/testing/mocks/billing-subscription.mock'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/billing/core/subscription', () => billingSubscriptionMock)
vi.mock('@/lib/core/async-jobs', () => asyncJobsMock)

import { dispatchDueDrains } from '@/lib/data-drains/dispatcher'

const mockEnqueue = asyncJobsMockFns.mockJobQueue.enqueue
mockEnqueue.mockResolvedValue('job-id')
const mockIsEnterprise = billingSubscriptionMockFns.mockIsOrganizationOnEnterprisePlan

function mockCandidates(rows: Array<{ id: string; organizationId: string }>) {
  // db.select().from().where() — override `from` so awaiting `.where(pred)`
  // resolves with the candidate rows.
  dbChainMockFns.from.mockReturnValueOnce({
    where: vi.fn().mockResolvedValueOnce(rows),
  } as never)
}

beforeEach(() => {
  resetDbChainMock()
})

beforeAll(() => {
  setEnvFlags({ isBillingEnabled: true })
})

afterAll(resetEnvFlagsMock)

describe('dispatchDueDrains', () => {
  it('skips drains for orgs not on enterprise plan', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([]) // reaper
    mockCandidates([{ id: 'd1', organizationId: 'org-a' }])
    mockIsEnterprise.mockResolvedValueOnce(false)

    const result = await dispatchDueDrains()
    expect(result).toMatchObject({ candidates: 1, dispatched: 0, skipped: 1 })
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('does not enqueue when claim loses the race', async () => {
    dbChainMockFns.returning
      .mockResolvedValueOnce([]) // reaper
      .mockResolvedValueOnce([]) // claim returns nothing — lost the race
    mockCandidates([{ id: 'd1', organizationId: 'org-a' }])
    mockIsEnterprise.mockResolvedValueOnce(true)

    const result = await dispatchDueDrains()
    expect(result.dispatched).toBe(0)
    expect(mockEnqueue).not.toHaveBeenCalled()
  })
})
