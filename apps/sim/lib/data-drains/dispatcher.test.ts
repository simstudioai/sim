/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => dbChainMock)

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
vi.mock('@/lib/core/config/feature-flags', () => ({ isBillingEnabled: true }))

import { dispatchDueDrains, reapOrphanedRuns } from '@/lib/data-drains/dispatcher'

function mockCandidates(rows: Array<{ id: string; organizationId: string }>) {
  // db.select().from().where() — override `from` so awaiting `.where(pred)`
  // resolves with the candidate rows.
  dbChainMockFns.from.mockReturnValueOnce({
    where: vi.fn().mockResolvedValueOnce(rows),
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
})

describe('reapOrphanedRuns', () => {
  it('returns the count of rows updated to failed', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'run-1' }, { id: 'run-2' }])
    const result = await reapOrphanedRuns(new Date('2026-01-01T12:00:00.000Z'))
    expect(result).toEqual({ reaped: 2 })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', error: expect.stringContaining('Orphaned') })
    )
  })

  it('returns 0 when nothing is stuck', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])
    expect(await reapOrphanedRuns()).toEqual({ reaped: 0 })
  })
})

describe('dispatchDueDrains', () => {
  it('returns early when no candidates are due', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([]) // reaper
    mockCandidates([])

    const result = await dispatchDueDrains()
    expect(result).toEqual({ candidates: 0, dispatched: 0, skipped: 0, reaped: 0 })
    expect(mockGetJobQueue).not.toHaveBeenCalled()
  })

  it('skips drains for orgs not on enterprise plan', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([]) // reaper
    mockCandidates([{ id: 'd1', organizationId: 'org-a' }])
    mockIsEnterprise.mockResolvedValueOnce(false)

    const result = await dispatchDueDrains()
    expect(result).toMatchObject({ candidates: 1, dispatched: 0, skipped: 1 })
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('claims and enqueues a job per due drain', async () => {
    dbChainMockFns.returning
      .mockResolvedValueOnce([]) // reaper
      .mockResolvedValueOnce([{ id: 'd1' }]) // claim succeeds
    mockCandidates([{ id: 'd1', organizationId: 'org-a' }])
    mockIsEnterprise.mockResolvedValueOnce(true)

    const result = await dispatchDueDrains()
    expect(result).toMatchObject({ candidates: 1, dispatched: 1, skipped: 0 })
    expect(mockEnqueue).toHaveBeenCalledWith(
      'run-data-drain',
      { drainId: 'd1', trigger: 'cron' },
      { concurrencyKey: 'data-drain:d1' }
    )
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

  it('caches enterprise check across drains in the same org', async () => {
    dbChainMockFns.returning
      .mockResolvedValueOnce([]) // reaper
      .mockResolvedValueOnce([{ id: 'd1' }])
      .mockResolvedValueOnce([{ id: 'd2' }])
    mockCandidates([
      { id: 'd1', organizationId: 'org-a' },
      { id: 'd2', organizationId: 'org-a' },
    ])
    mockIsEnterprise.mockResolvedValue(true)

    await dispatchDueDrains()
    expect(mockIsEnterprise).toHaveBeenCalledTimes(1)
  })
})
