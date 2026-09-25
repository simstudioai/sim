import { dbChainMockFns, resetDbChainMock, resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsEnterprise, mockEnqueue, mockGetJobQueue } = vi.hoisted(() => {
  const mockEnqueue = vi.fn(async () => 'job-id')
  return {
    mockIsEnterprise: vi.fn(),
    mockEnqueue,
    mockGetJobQueue: vi.fn(async () => ({ enqueue: mockEnqueue })),
  }
})

vi.mock('@/lib/billing/core/subscription', () => ({
  isOrganizationOnEnterprisePlan: mockIsEnterprise,
}))
vi.mock('@/lib/core/async-jobs', () => ({ getJobQueue: mockGetJobQueue }))

import { dispatchDueDrains } from '@/lib/data-drains/dispatcher'

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
