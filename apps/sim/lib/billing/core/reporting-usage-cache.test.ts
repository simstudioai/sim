/**
 * @vitest-environment node
 */
import { db } from '@sim/db'
import { sleep } from '@sim/utils/helpers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetBillingPeriodUsageCost } = vi.hoisted(() => ({
  mockGetBillingPeriodUsageCost: vi.fn(),
}))

vi.mock('@/lib/billing/core/usage-log', () => ({
  getBillingPeriodUsageCost: mockGetBillingPeriodUsageCost,
}))

import * as reportingUsageCache from '@/lib/billing/core/reporting-usage-cache'
import type { UsageQueryPeriod } from '@/lib/billing/core/usage-log'

const { REPORTING_USAGE_CACHE_TTL_MS, readSoftGateUsageCost } = reportingUsageCache

const REPORTING: UsageQueryPeriod = {
  start: new Date('2026-01-01T00:00:00.000Z'),
  end: new Date('2027-01-01T00:00:00.000Z'),
  source: 'reporting',
}
const NEXT_REPORTING: UsageQueryPeriod = {
  start: new Date('2027-01-01T00:00:00.000Z'),
  end: new Date('2028-01-01T00:00:00.000Z'),
  source: 'reporting',
}
const STRIPE: UsageQueryPeriod = {
  start: new Date('2026-09-01T00:00:00.000Z'),
  end: new Date('2026-10-01T00:00:00.000Z'),
  source: 'stripe',
}

let nextOrg = 0
/** A fresh payer per test, since the cache is module state shared across tests. */
function freshOrg() {
  nextOrg += 1
  return { type: 'organization' as const, id: `org-${nextOrg}` }
}

describe('readSoftGateUsageCost on a reporting window', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetBillingPeriodUsageCost.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sums the ledger again once a cached sum outlives its TTL', async () => {
    const org = freshOrg()
    const start = performance.now()
    const clock = vi.spyOn(performance, 'now').mockReturnValue(start)
    mockGetBillingPeriodUsageCost.mockResolvedValueOnce(10).mockResolvedValueOnce(25)

    await expect(readSoftGateUsageCost(org, REPORTING)).resolves.toBe(10)
    /** The cache re-reads its clock only after `ttlResolution` (1 ms) of real time. */
    clock.mockReturnValue(start + REPORTING_USAGE_CACHE_TTL_MS - 1)
    await sleep(2)
    await expect(readSoftGateUsageCost(org, REPORTING)).resolves.toBe(10)
    clock.mockReturnValue(start + REPORTING_USAGE_CACHE_TTL_MS + 1)
    await sleep(2)
    await expect(readSoftGateUsageCost(org, REPORTING)).resolves.toBe(25)
    expect(mockGetBillingPeriodUsageCost).toHaveBeenCalledTimes(2)
  })

  it('coalesces concurrent and repeated reads of one window into one ledger sum', async () => {
    const org = freshOrg()
    let resolveSum: (value: number) => void = () => {}
    mockGetBillingPeriodUsageCost.mockReturnValueOnce(
      new Promise<number>((resolve) => {
        resolveSum = resolve
      })
    )

    const concurrent = Promise.all([
      readSoftGateUsageCost(org, REPORTING),
      readSoftGateUsageCost(org, REPORTING),
      readSoftGateUsageCost(org, REPORTING),
    ])
    resolveSum(42)

    await expect(concurrent).resolves.toEqual([42, 42, 42])
    await expect(readSoftGateUsageCost(org, REPORTING)).resolves.toBe(42)
    expect(mockGetBillingPeriodUsageCost).toHaveBeenCalledTimes(1)
    expect(mockGetBillingPeriodUsageCost).toHaveBeenCalledWith(org, REPORTING)
  })

  it('serves a zero sum from cache rather than re-reading it', async () => {
    const org = freshOrg()
    mockGetBillingPeriodUsageCost.mockResolvedValue(0)

    await expect(readSoftGateUsageCost(org, REPORTING)).resolves.toBe(0)
    await expect(readSoftGateUsageCost(org, REPORTING)).resolves.toBe(0)
    expect(mockGetBillingPeriodUsageCost).toHaveBeenCalledTimes(1)
  })

  it('keeps separate sums for different payers and windows', async () => {
    const first = freshOrg()
    const second = freshOrg()
    mockGetBillingPeriodUsageCost
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(4)

    await expect(readSoftGateUsageCost(first, REPORTING)).resolves.toBe(1)
    await expect(readSoftGateUsageCost(second, REPORTING)).resolves.toBe(2)
    await expect(readSoftGateUsageCost(first, NEXT_REPORTING)).resolves.toBe(3)
    await expect(readSoftGateUsageCost({ type: 'user', id: first.id }, REPORTING)).resolves.toBe(4)
    expect(mockGetBillingPeriodUsageCost).toHaveBeenCalledTimes(4)
  })

  it('surfaces a failed sum to every waiting caller and never caches it', async () => {
    const org = freshOrg()
    const failure = new Error('canceling statement due to statement timeout')
    mockGetBillingPeriodUsageCost.mockRejectedValueOnce(failure).mockResolvedValueOnce(17)

    const results = await Promise.allSettled([
      readSoftGateUsageCost(org, REPORTING),
      readSoftGateUsageCost(org, REPORTING),
    ])
    expect(results).toEqual([
      { status: 'rejected', reason: failure },
      { status: 'rejected', reason: failure },
    ])

    await expect(readSoftGateUsageCost(org, REPORTING)).resolves.toBe(17)
    expect(mockGetBillingPeriodUsageCost).toHaveBeenCalledTimes(2)
  })
})

describe('readSoftGateUsageCost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetBillingPeriodUsageCost.mockReset()
  })

  it('exposes no cached reader that a non-reporting period could reach', () => {
    expect(Object.keys(reportingUsageCache).sort()).toEqual([
      'REPORTING_USAGE_CACHE_TTL_MS',
      'readSoftGateUsageCost',
    ])
  })

  it('never serves a cached reporting sum to another source with the same bounds', async () => {
    const org = freshOrg()
    const sameBounds = { start: REPORTING.start, end: REPORTING.end }
    mockGetBillingPeriodUsageCost.mockResolvedValueOnce(10).mockResolvedValueOnce(99)

    await expect(readSoftGateUsageCost(org, REPORTING)).resolves.toBe(10)
    await expect(readSoftGateUsageCost(org, { ...sameBounds, source: 'stripe' })).resolves.toBe(99)
    await expect(readSoftGateUsageCost(org, REPORTING)).resolves.toBe(10)
    expect(mockGetBillingPeriodUsageCost).toHaveBeenCalledTimes(2)
  })

  it('serves reporting windows from the cache', async () => {
    const org = freshOrg()
    mockGetBillingPeriodUsageCost.mockResolvedValue(10)

    await readSoftGateUsageCost(org, REPORTING)
    await readSoftGateUsageCost(org, REPORTING)

    expect(mockGetBillingPeriodUsageCost).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['stripe', STRIPE],
    ['default', { ...STRIPE, source: 'default' as const }],
    ['unlabelled', { start: STRIPE.start, end: STRIPE.end }],
  ])('sums %s periods exactly on every call', async (_label, period) => {
    const org = freshOrg()
    mockGetBillingPeriodUsageCost.mockResolvedValue(10)

    await readSoftGateUsageCost(org, period)
    await readSoftGateUsageCost(org, period)

    expect(mockGetBillingPeriodUsageCost).toHaveBeenCalledTimes(2)
    expect(mockGetBillingPeriodUsageCost).toHaveBeenCalledWith(org, period, undefined, db)
  })

  it('reads a reporting window exactly on a caller-supplied executor', async () => {
    const org = freshOrg()
    const executor = { transaction: vi.fn() } as unknown as typeof db
    mockGetBillingPeriodUsageCost.mockResolvedValue(10)

    await readSoftGateUsageCost(org, REPORTING, executor)
    await readSoftGateUsageCost(org, REPORTING, executor)

    expect(mockGetBillingPeriodUsageCost).toHaveBeenCalledTimes(2)
    expect(mockGetBillingPeriodUsageCost).toHaveBeenCalledWith(org, REPORTING, undefined, executor)
  })
})
