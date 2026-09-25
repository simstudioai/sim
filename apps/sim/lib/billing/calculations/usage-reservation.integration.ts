/**
 * Pooled reservations against real Redis Lua scripts. Requires `TEST_REDIS_URL`; the hosted
 * billing flags and the Redis client accessor are the only fixtures.
 */
import { envFlagsMock, setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { redisConfigMock, redisConfigMockFns } from '@sim/testing/mocks/redis-config.mock'
import { generateId } from '@sim/utils/id'
import Redis from 'ioredis'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  refreshExecutionSlotExpiry,
  releaseExecutionSlot,
  reserveExecutionSlot,
} from '@/lib/billing/calculations/usage-reservation'

vi.mock('@/lib/core/config/env-flags', () => envFlagsMock)
vi.mock('@/lib/core/config/redis', () => redisConfigMock)

const redisUrl = process.env.TEST_REDIS_URL
if (!redisUrl) throw new Error('Set TEST_REDIS_URL to a disposable local Redis')

describe('pooled usage reservations with Redis', () => {
  let redis: Redis
  const reservations: string[] = []
  const payer = { type: 'organization' as const, id: generateId() }

  beforeAll(async () => {
    redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 0 })
    await redis.connect()
  })

  beforeEach(() => {
    setEnvFlags({ isHosted: true, isBillingEnabled: true })
    redisConfigMockFns.mockGetRedisClient.mockReturnValue(redis)
  })

  afterEach(async () => {
    await Promise.all(reservations.splice(0).map(releaseExecutionSlot))
  })

  afterAll(async () => {
    await redis?.quit()
  })

  function params(actorUserId = generateId()) {
    const reservationId = generateId()
    reservations.push(reservationId)
    return {
      billingEntity: payer,
      reservationId,
      plan: 'enterprise' as const,
      currentUsage: 0,
      limit: 0.05,
      member: { organizationId: payer.id, actorUserId, currentUsage: 0, limit: 0.01 },
    }
  }

  it('shares payer headroom across 100 concurrent requests from different members', async () => {
    const requests = Array.from({ length: 100 }, () => params())
    const results = await Promise.all(requests.map(reserveExecutionSlot))
    expect(results.filter((result) => result.reserved)).toHaveLength(10)
    expect(results.filter((result) => !result.reserved)).toEqual(
      Array.from({ length: 90 }, () => ({ reserved: false, reason: 'payer_headroom' }))
    )
    expect(
      await reserveExecutionSlot({
        ...params(),
        billingEntity: { type: 'organization', id: generateId() },
        member: undefined,
      })
    ).toEqual({ reserved: true, created: true })
  })

  it('isolates member caps inside the shared payer without consuming rejected slots', async () => {
    const memberA = generateId()
    const memberB = generateId()
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, index) =>
        reserveExecutionSlot(params(index < 20 ? memberA : memberB))
      )
    )
    expect(results.slice(0, 20).filter((result) => result.reserved)).toHaveLength(2)
    expect(results.slice(20).filter((result) => result.reserved)).toHaveLength(2)
    expect(results.filter((result) => !result.reserved)).toEqual(
      Array.from({ length: 36 }, () => ({ reserved: false, reason: 'member_headroom' }))
    )
    expect(await reserveExecutionSlot(params())).toEqual({ reserved: true, created: true })
  })

  it('preserves duplicate ownership and queued-worker refresh without new admission', async () => {
    const request = params()
    const results = await Promise.all(
      Array.from({ length: 20 }, () => reserveExecutionSlot(request))
    )
    expect(results.filter((result) => result.reserved && result.created)).toHaveLength(1)
    expect(results.every((result) => result.reserved)).toBe(true)
    expect(await refreshExecutionSlotExpiry(request.reservationId, Date.now() + 60_000)).toBe(true)
    await releaseExecutionSlot(request.reservationId)
    expect(await refreshExecutionSlotExpiry(request.reservationId, Date.now() + 60_000)).toBe(false)
    expect(await reserveExecutionSlot({ ...params(), currentUsage: 0.05 })).toEqual({
      reserved: false,
      reason: 'payer_headroom',
    })
  })
})
