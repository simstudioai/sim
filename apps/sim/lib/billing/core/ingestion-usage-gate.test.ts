/**
 * @vitest-environment node
 */
import { sleep } from '@sim/utils/helpers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheck } = vi.hoisted(() => ({ mockCheck: vi.fn() }))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  checkAttributedUsageLimits: mockCheck,
}))

import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import {
  checkIngestionUsageLimits,
  INGESTION_USAGE_GATE_TTL_MS,
  resetIngestionUsageGateCache,
} from '@/lib/billing/core/ingestion-usage-gate'

const ATTRIBUTION: BillingAttributionSnapshot = {
  actorUserId: 'member-1',
  workspaceId: null,
  organizationId: 'org-1',
  billedAccountUserId: 'owner-1',
  billingEntity: { type: 'organization', id: 'org-1' },
  billingPeriod: {
    start: '2026-09-01T00:00:00.000Z',
    end: '2026-10-01T00:00:00.000Z',
    source: 'stripe',
  },
  payerSubscription: null,
}

describe('checkIngestionUsageLimits', () => {
  beforeEach(() => {
    resetIngestionUsageGateCache()
    mockCheck.mockReset().mockResolvedValue({ isExceeded: false })
  })
  afterEach(() => vi.restoreAllMocks())

  it('reads the ledger once per payer, period and actor within the TTL', async () => {
    await checkIngestionUsageLimits(ATTRIBUTION)
    await checkIngestionUsageLimits(ATTRIBUTION)
    await checkIngestionUsageLimits({ ...ATTRIBUTION, workspaceId: 'workspace-9' })
    expect(mockCheck).toHaveBeenCalledTimes(1)
  })

  it('collapses concurrent misses onto one ledger read', async () => {
    let resolve!: (value: { isExceeded: boolean }) => void
    mockCheck.mockReturnValueOnce(new Promise((r) => (resolve = r)))
    const pending = Promise.all([
      checkIngestionUsageLimits(ATTRIBUTION),
      checkIngestionUsageLimits(ATTRIBUTION),
      checkIngestionUsageLimits(ATTRIBUTION),
    ])
    await sleep(0)
    resolve({ isExceeded: false })
    const results = await pending
    expect(results.every((result) => result.isExceeded === false)).toBe(true)
    expect(mockCheck).toHaveBeenCalledTimes(1)
  })

  it('keeps a refusal for the same bounded window, then reads fresh', async () => {
    mockCheck.mockResolvedValueOnce({ isExceeded: true, scope: 'payer', message: 'over' })
    expect((await checkIngestionUsageLimits(ATTRIBUTION)).isExceeded).toBe(true)
    expect((await checkIngestionUsageLimits(ATTRIBUTION)).isExceeded).toBe(true)
    expect(mockCheck).toHaveBeenCalledTimes(1)

    /** `lru-cache` reads `performance.now()` and debounces it behind a real 1 ms timer. */
    const start = performance.now()
    vi.spyOn(performance, 'now').mockReturnValue(start + INGESTION_USAGE_GATE_TTL_MS + 1)
    await sleep(5)
    expect((await checkIngestionUsageLimits(ATTRIBUTION)).isExceeded).toBe(false)
    expect(mockCheck).toHaveBeenCalledTimes(2)
  })

  it('separates answers by actor, period and payer', async () => {
    await checkIngestionUsageLimits(ATTRIBUTION)
    await checkIngestionUsageLimits({ ...ATTRIBUTION, actorUserId: 'member-2' })
    await checkIngestionUsageLimits({
      ...ATTRIBUTION,
      billingPeriod: { ...ATTRIBUTION.billingPeriod, start: '2026-10-01T00:00:00.000Z' },
    })
    await checkIngestionUsageLimits({
      ...ATTRIBUTION,
      billedAccountUserId: 'owner-2',
      billingEntity: { type: 'user', id: 'owner-2' },
    })
    expect(mockCheck).toHaveBeenCalledTimes(4)
  })

  it('does not cache a failed read', async () => {
    mockCheck.mockRejectedValueOnce(new Error('ledger unavailable'))
    await expect(checkIngestionUsageLimits(ATTRIBUTION)).rejects.toThrow('ledger unavailable')
    await checkIngestionUsageLimits(ATTRIBUTION)
    expect(mockCheck).toHaveBeenCalledTimes(2)
  })
})
