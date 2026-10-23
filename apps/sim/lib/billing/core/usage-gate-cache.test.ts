import { flushMacrotask } from '@sim/testing/helpers/async'
import { createDeferred } from '@sim/testing/helpers/deferred'
import {
  billingAttributionMock,
  billingAttributionMockFns,
} from '@sim/testing/mocks/billing-attribution.mock'
import { sleep } from '@sim/utils/helpers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/billing/core/attribution', () => billingAttributionMock)

import type { BillingAttributionSnapshot } from '@/lib/billing/core/attribution'
import {
  checkExecutionUsageLimits,
  checkIngestionUsageLimits,
  checkSearchUsageLimits,
  NEAR_LIMIT_USAGE_GATE_TTL_MS,
  resetUsageGateCache,
  USAGE_GATE_SETTLE_TIMEOUT_MS,
  USAGE_GATE_TTL_MS,
} from '@/lib/billing/core/usage-gate-cache'

const mockCheck = billingAttributionMockFns.mockCheckAttributedUsageLimits

/** Fakes `setTimeout` for {@link advanceClockPast}; install it before the cache is first read. */
function useFakeTimeouts(): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
}

/**
 * Fires the cache's pending clock debounce before restoring real timers; dropped unfired, it would
 * pin the module-level cache to this test's spied clock for every later test.
 */
function restoreRealTimers(): void {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
}

/**
 * `lru-cache` captures `performance` at load, so fake timers cannot move its clock: spy the clock
 * forward, then fire the faked 1 ms timer behind which it debounces `performance.now()`.
 */
async function advanceClockPast(ms: number): Promise<void> {
  const start = performance.now()
  vi.spyOn(performance, 'now').mockReturnValue(start + ms + 1)
  await vi.advanceTimersByTimeAsync(1)
}

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

  it('reads the ledger once per payer, period and actor within the TTL', async () => {
    await checkIngestionUsageLimits(ATTRIBUTION)
    await checkIngestionUsageLimits(ATTRIBUTION)
    await checkIngestionUsageLimits({ ...ATTRIBUTION, workspaceId: 'workspace-9' })
    expect(mockCheck).toHaveBeenCalledTimes(1)
  })

  it('collapses concurrent misses onto one ledger read', async () => {
    const ledger = createDeferred<{ isExceeded: boolean }>()
    mockCheck.mockReturnValueOnce(ledger.promise)
    const pending = Promise.all([
      checkIngestionUsageLimits(ATTRIBUTION),
      checkIngestionUsageLimits(ATTRIBUTION),
      checkIngestionUsageLimits(ATTRIBUTION),
    ])
    await flushMacrotask()
    ledger.resolve({ isExceeded: false })
    const results = await pending
    expect(results.every((result) => result.isExceeded === false)).toBe(true)
    expect(mockCheck).toHaveBeenCalledTimes(1)
  })

  it('keeps a refusal for the same bounded window, then reads fresh', async () => {
    useFakeTimeouts()
    try {
      mockCheck.mockResolvedValueOnce({ isExceeded: true, scope: 'payer', message: 'over' })
      expect((await checkIngestionUsageLimits(ATTRIBUTION)).isExceeded).toBe(true)
      expect((await checkIngestionUsageLimits(ATTRIBUTION)).isExceeded).toBe(true)
      expect(mockCheck).toHaveBeenCalledTimes(1)

      await advanceClockPast(USAGE_GATE_TTL_MS)
      expect((await checkIngestionUsageLimits(ATTRIBUTION)).isExceeded).toBe(false)
      expect(mockCheck).toHaveBeenCalledTimes(2)
    } finally {
      restoreRealTimers()
    }
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

  it('waits for a slow ledger read past the singleflight default instead of blocking', async () => {
    vi.useFakeTimers()
    try {
      mockCheck.mockImplementationOnce(() => sleep(45_000).then(() => ({ isExceeded: false })))
      const pending = checkExecutionUsageLimits(ATTRIBUTION)
      await vi.advanceTimersByTimeAsync(45_000)
      await expect(pending).resolves.toEqual({ isExceeded: false })
      expect(mockCheck).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives up on a read that never answers at the gate deadline, then reads fresh', async () => {
    vi.useFakeTimers()
    try {
      mockCheck.mockReturnValueOnce(new Promise(() => {}))
      const hung = checkExecutionUsageLimits(ATTRIBUTION)
      const rejection = expect(hung).rejects.toThrow(
        `did not settle within ${USAGE_GATE_SETTLE_TIMEOUT_MS}ms`
      )
      await vi.advanceTimersByTimeAsync(USAGE_GATE_SETTLE_TIMEOUT_MS)
      await rejection
      await expect(checkExecutionUsageLimits(ATTRIBUTION)).resolves.toEqual({
        isExceeded: false,
      })
      expect(mockCheck).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('admission lifetime by headroom', () => {
  beforeEach(() => {
    useFakeTimeouts()
    resetUsageGateCache()
    mockCheck.mockReset()
  })

  afterEach(() => {
    restoreRealTimers()
  })

  it('re-reads a free-plan admission after the near-limit window, so spend past the limit is refused', async () => {
    mockCheck
      .mockResolvedValueOnce({ isExceeded: false, payerUsage: { currentUsage: 1, limit: 5 } })
      .mockResolvedValueOnce({
        isExceeded: true,
        scope: 'payer',
        message: 'over',
        payerUsage: { currentUsage: 5.4, limit: 5 },
      })
    expect((await checkExecutionUsageLimits(ATTRIBUTION)).isExceeded).toBe(false)
    expect((await checkExecutionUsageLimits(ATTRIBUTION)).isExceeded).toBe(false)
    expect(mockCheck).toHaveBeenCalledTimes(1)

    await advanceClockPast(NEAR_LIMIT_USAGE_GATE_TTL_MS)
    expect((await checkExecutionUsageLimits(ATTRIBUTION)).isExceeded).toBe(true)
    expect(mockCheck).toHaveBeenCalledTimes(2)
  })

  it('re-reads a large pool in the last fifth of its limit', async () => {
    mockCheck.mockResolvedValue({
      isExceeded: false,
      payerUsage: { currentUsage: 900, limit: 1000 },
    })
    await checkExecutionUsageLimits(ATTRIBUTION)
    await advanceClockPast(NEAR_LIMIT_USAGE_GATE_TTL_MS)
    await checkExecutionUsageLimits(ATTRIBUTION)
    expect(mockCheck).toHaveBeenCalledTimes(2)
  })

  it('re-reads when the acting member is near their cap though the pool has room', async () => {
    mockCheck.mockResolvedValue({
      isExceeded: false,
      payerUsage: { currentUsage: 100, limit: 1000 },
      memberUsage: { currentUsage: 48, limit: 50 },
    })
    await checkSearchUsageLimits(ATTRIBUTION)
    await advanceClockPast(NEAR_LIMIT_USAGE_GATE_TTL_MS)
    await checkSearchUsageLimits(ATTRIBUTION)
    expect(mockCheck).toHaveBeenCalledTimes(2)
  })

  it('holds an admission with ample headroom for the full TTL', async () => {
    mockCheck.mockResolvedValue({
      isExceeded: false,
      payerUsage: { currentUsage: 100, limit: 1000 },
      memberUsage: { currentUsage: 10, limit: null },
    })
    await checkExecutionUsageLimits(ATTRIBUTION)
    await advanceClockPast(NEAR_LIMIT_USAGE_GATE_TTL_MS)
    await checkExecutionUsageLimits(ATTRIBUTION)
    expect(mockCheck).toHaveBeenCalledTimes(1)

    await advanceClockPast(USAGE_GATE_TTL_MS)
    await checkExecutionUsageLimits(ATTRIBUTION)
    expect(mockCheck).toHaveBeenCalledTimes(2)
  })
})
