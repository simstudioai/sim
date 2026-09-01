/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolveOrganizationPlan, mockIsHosted } = vi.hoisted(() => ({
  mockResolveOrganizationPlan: vi.fn(),
  mockIsHosted: { value: true },
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  resolveOrganizationPlan: mockResolveOrganizationPlan,
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  get isHosted() {
    return mockIsHosted.value
  },
}))

import {
  isOrganizationBYOKEntitled,
  isOrganizationBYOKEntitledCached,
  resetOrganizationBYOKEntitlementCache,
} from '@/lib/api-key/byok-entitlement'
import { __resetCoalesceLocallyForTests } from '@/lib/concurrency/singleflight'

const ORGANIZATION_ID = 'org-1'

describe('organization BYOK entitlement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetOrganizationBYOKEntitlementCache()
    __resetCoalesceLocallyForTests()
    mockIsHosted.value = true
    mockResolveOrganizationPlan.mockResolvedValue(true)
  })

  it('reads the plan fresh on the authoritative path so an upgrade is never withheld', async () => {
    await expect(isOrganizationBYOKEntitled(ORGANIZATION_ID)).resolves.toBe(true)
    await expect(isOrganizationBYOKEntitled(ORGANIZATION_ID)).resolves.toBe(true)

    expect(mockResolveOrganizationPlan).toHaveBeenCalledTimes(2)
  })

  it('serves the execution path from cache instead of re-reading billing', async () => {
    await expect(isOrganizationBYOKEntitledCached(ORGANIZATION_ID)).resolves.toBe(true)
    await expect(isOrganizationBYOKEntitledCached(ORGANIZATION_ID)).resolves.toBe(true)
    await expect(isOrganizationBYOKEntitledCached(ORGANIZATION_ID)).resolves.toBe(true)

    expect(mockResolveOrganizationPlan).toHaveBeenCalledTimes(1)
  })

  /**
   * Caching the promise (not the resolved value) is what makes this hold: the
   * entry is written synchronously after the promise is created, with no await
   * in between, so a second caller can never miss it and start a rival read.
   * Expiry itself is `LRUCache`'s job and is not re-tested here.
   */
  it('collapses concurrent resolutions into one query set', async () => {
    let release: (value: boolean) => void = () => {}
    mockResolveOrganizationPlan.mockReturnValue(
      new Promise<boolean>((resolve) => {
        release = resolve
      })
    )

    const inflight = Promise.all([
      isOrganizationBYOKEntitledCached(ORGANIZATION_ID),
      isOrganizationBYOKEntitledCached(ORGANIZATION_ID),
      isOrganizationBYOKEntitledCached(ORGANIZATION_ID),
    ])

    release(true)

    await expect(inflight).resolves.toEqual([true, true, true])
    expect(mockResolveOrganizationPlan).toHaveBeenCalledTimes(1)
  })

  /**
   * The cached value is a boolean, so a truthiness check would read a cached
   * `false` as a miss — re-querying billing on every resolution for exactly the
   * organizations the cache exists to protect (lapsed ones still holding keys).
   */
  it('serves a cached false without re-reading billing', async () => {
    mockResolveOrganizationPlan.mockResolvedValue(false)

    await expect(isOrganizationBYOKEntitledCached(ORGANIZATION_ID)).resolves.toBe(false)
    await expect(isOrganizationBYOKEntitledCached(ORGANIZATION_ID)).resolves.toBe(false)
    await expect(isOrganizationBYOKEntitledCached(ORGANIZATION_ID)).resolves.toBe(false)

    expect(mockResolveOrganizationPlan).toHaveBeenCalledTimes(1)
  })

  it('keeps organizations in separate cache entries', async () => {
    mockResolveOrganizationPlan.mockImplementation(async (id: string) => id === ORGANIZATION_ID)

    await expect(isOrganizationBYOKEntitledCached(ORGANIZATION_ID)).resolves.toBe(true)
    await expect(isOrganizationBYOKEntitledCached('org-2')).resolves.toBe(false)
    await expect(isOrganizationBYOKEntitledCached(ORGANIZATION_ID)).resolves.toBe(true)

    expect(mockResolveOrganizationPlan).toHaveBeenCalledTimes(2)
  })

  /**
   * The rejection path only exists in production because the cached read asks
   * for it. `resolveOrganizationPlan` otherwise maps a billing outage to
   * `false` — indistinguishable from a real lapse — and caching that would hold
   * the gate shut for the full TTL, silently metering every inheriting run.
   */
  it('asks billing to throw rather than report an outage as unentitled', async () => {
    await isOrganizationBYOKEntitledCached(ORGANIZATION_ID)

    expect(mockResolveOrganizationPlan).toHaveBeenCalledWith(ORGANIZATION_ID, {
      onError: 'throw',
    })
  })

  it('does not cache a rejection, so a transient failure cannot pin the gate shut', async () => {
    mockResolveOrganizationPlan.mockRejectedValueOnce(new Error('billing read failed'))

    await expect(isOrganizationBYOKEntitledCached(ORGANIZATION_ID)).rejects.toThrow(
      'billing read failed'
    )

    mockResolveOrganizationPlan.mockResolvedValue(true)
    await expect(isOrganizationBYOKEntitledCached(ORGANIZATION_ID)).resolves.toBe(true)
    expect(mockResolveOrganizationPlan).toHaveBeenCalledTimes(2)
  })

  /**
   * `coalesceLocally` does not cancel a producer it timed out, so a write from
   * inside the producer could land after a retry cached a fresher answer and
   * overwrite it for a full TTL. Keeping the write on the value the caller
   * received means an abandoned producer resolves into nothing.
   */
  it('ignores a producer that settles after its caller gave up', async () => {
    let releaseAbandoned: (value: boolean) => void = () => {}
    mockResolveOrganizationPlan.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        releaseAbandoned = resolve
      })
    )

    const abandoned = isOrganizationBYOKEntitledCached(ORGANIZATION_ID)
    abandoned.catch(() => {})
    __resetCoalesceLocallyForTests()

    mockResolveOrganizationPlan.mockResolvedValue(false)
    await expect(isOrganizationBYOKEntitledCached(ORGANIZATION_ID)).resolves.toBe(false)

    releaseAbandoned(true)
    await Promise.resolve()

    await expect(isOrganizationBYOKEntitledCached(ORGANIZATION_ID)).resolves.toBe(false)
  })

  it('never consults billing off hosted, on either path', async () => {
    mockIsHosted.value = false

    await expect(isOrganizationBYOKEntitled(ORGANIZATION_ID)).resolves.toBe(false)
    await expect(isOrganizationBYOKEntitledCached(ORGANIZATION_ID)).resolves.toBe(false)

    expect(mockResolveOrganizationPlan).not.toHaveBeenCalled()
  })
})
