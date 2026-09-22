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
  checkExecutionUsageLimits,
  checkIngestionUsageLimits,
  checkSearchUsageLimits,
  resetUsageGateCache,
  USAGE_GATE_TTL_MS,
} from '@/lib/billing/core/usage-gate-cache'

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

const SUBSCRIPTION: BillingAttributionSnapshot['payerSubscription'] = {
  id: 'sub-1',
  referenceId: 'org-1',
  plan: 'team',
  status: 'active',
  seats: 5,
  periodStart: '2026-09-01T00:00:00.000Z',
  periodEnd: '2026-10-01T00:00:00.000Z',
}

describe('checkIngestionUsageLimits', () => {
  beforeEach(() => {
    resetUsageGateCache()
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
    vi.spyOn(performance, 'now').mockReturnValue(start + USAGE_GATE_TTL_MS + 1)
    await sleep(5)
    expect((await checkIngestionUsageLimits(ATTRIBUTION)).isExceeded).toBe(false)
    expect(mockCheck).toHaveBeenCalledTimes(2)
  })

  it('separates answers by actor, period, period source, payer and plan', async () => {
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
    await checkIngestionUsageLimits({
      ...ATTRIBUTION,
      billingPeriod: { ...ATTRIBUTION.billingPeriod, source: 'reporting' },
    })
    await checkIngestionUsageLimits({ ...ATTRIBUTION, payerSubscription: SUBSCRIPTION })
    await checkIngestionUsageLimits({
      ...ATTRIBUTION,
      payerSubscription: { ...SUBSCRIPTION, plan: 'enterprise' },
    })
    expect(mockCheck).toHaveBeenCalledTimes(7)
  })

  it('does not cache a failed read', async () => {
    mockCheck.mockRejectedValueOnce(new Error('ledger unavailable'))
    await expect(checkIngestionUsageLimits(ATTRIBUTION)).rejects.toThrow('ledger unavailable')
    await checkIngestionUsageLimits(ATTRIBUTION)
    expect(mockCheck).toHaveBeenCalledTimes(2)
  })
})

describe('checkSearchUsageLimits', () => {
  beforeEach(() => {
    resetUsageGateCache()
    mockCheck.mockReset().mockResolvedValue({ isExceeded: false })
  })

  it('reuses an admission across workspaces of the same payer', async () => {
    await checkSearchUsageLimits(ATTRIBUTION)
    await checkSearchUsageLimits({ ...ATTRIBUTION, workspaceId: 'workspace-9' })
    expect(mockCheck).toHaveBeenCalledTimes(1)
  })

  it('re-reads a refusal, so a raised limit applies on the next search', async () => {
    mockCheck.mockResolvedValueOnce({ isExceeded: true, scope: 'payer', message: 'over' })
    expect((await checkSearchUsageLimits(ATTRIBUTION)).isExceeded).toBe(true)
    expect((await checkSearchUsageLimits(ATTRIBUTION)).isExceeded).toBe(false)
    expect(mockCheck).toHaveBeenCalledTimes(2)
  })

  it('does not serve a refusal cached by ingestion', async () => {
    mockCheck.mockResolvedValueOnce({ isExceeded: true, scope: 'payer', message: 'over' })
    expect((await checkIngestionUsageLimits(ATTRIBUTION)).isExceeded).toBe(true)
    expect((await checkSearchUsageLimits(ATTRIBUTION)).isExceeded).toBe(false)
    expect((await checkIngestionUsageLimits(ATTRIBUTION)).isExceeded).toBe(false)
    expect(mockCheck).toHaveBeenCalledTimes(2)
  })

  it('never stores a refusal for ingestion to serve', async () => {
    mockCheck.mockResolvedValueOnce({ isExceeded: true, scope: 'payer', message: 'over' })
    expect((await checkSearchUsageLimits(ATTRIBUTION)).isExceeded).toBe(true)
    expect((await checkIngestionUsageLimits(ATTRIBUTION)).isExceeded).toBe(false)
    expect(mockCheck).toHaveBeenCalledTimes(2)
  })

  it('does not cache a failed read', async () => {
    mockCheck.mockRejectedValueOnce(new Error('ledger unavailable'))
    await expect(checkSearchUsageLimits(ATTRIBUTION)).rejects.toThrow('ledger unavailable')
    await checkSearchUsageLimits(ATTRIBUTION)
    expect(mockCheck).toHaveBeenCalledTimes(2)
  })
})

describe('checkExecutionUsageLimits', () => {
  beforeEach(() => {
    resetUsageGateCache()
    mockCheck.mockReset().mockResolvedValue({ isExceeded: false })
  })

  it('reuses an admission across workspaces of the same payer', async () => {
    await checkExecutionUsageLimits(ATTRIBUTION)
    await checkExecutionUsageLimits({ ...ATTRIBUTION, workspaceId: 'ws-2' })
    expect(mockCheck).toHaveBeenCalledTimes(1)
  })

  it('re-reads a refusal', async () => {
    mockCheck.mockResolvedValue({ isExceeded: true, message: 'over' })
    await checkExecutionUsageLimits(ATTRIBUTION)
    await checkExecutionUsageLimits(ATTRIBUTION)
    expect(mockCheck).toHaveBeenCalledTimes(2)
  })
})
