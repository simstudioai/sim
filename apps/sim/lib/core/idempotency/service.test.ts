/**
 * @vitest-environment node
 */

import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { redisDelMock, redisEvalMock } = vi.hoisted(() => ({
  redisDelMock: vi.fn(),
  redisEvalMock: vi.fn(),
}))

vi.mock('@/lib/core/config/redis', () => ({
  getRedisClient: () => ({ del: redisDelMock, eval: redisEvalMock }),
}))

vi.mock('@/lib/core/storage', () => ({
  getStorageMethod: () => 'redis',
  isRedisStorage: () => true,
  isDatabaseStorage: () => false,
  requireRedis: () => ({ del: redisDelMock, eval: redisEvalMock }),
  resetStorageMethod: () => {},
}))

import { RetryableSetupError } from '@/lib/core/errors/retryable-infrastructure'
import {
  IdempotencyService,
  WEBHOOK_IN_PROGRESS_LEASE_SECONDS,
  webhookIdempotency,
} from '@/lib/core/idempotency/service'

const SEVEN_DAYS_SECONDS = 60 * 60 * 24 * 7

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

beforeEach(() => {
  resetDbChainMock()
})

describe('IdempotencyService.createWebhookIdempotencyKey', () => {
  it('uses Greenhouse-Event-ID when present', () => {
    const key = IdempotencyService.createWebhookIdempotencyKey(
      'wh_1',
      { 'greenhouse-event-id': 'evt-gh-99' },
      {},
      'greenhouse'
    )
    expect(key).toBe('wh_1:evt-gh-99')
  })

  it('prefers svix-id for Resend / Svix duplicate delivery deduplication', () => {
    const key = IdempotencyService.createWebhookIdempotencyKey(
      'wh_1',
      { 'svix-id': 'msg_abc123' },
      { type: 'email.sent' },
      'resend'
    )
    expect(key).toBe('wh_1:msg_abc123')
  })

  it('prefers Linear-Delivery so repeated updates to the same entity are not treated as one idempotent run', () => {
    const key = IdempotencyService.createWebhookIdempotencyKey(
      'wh_linear',
      { 'linear-delivery': '234d1a4e-b617-4388-90fe-adc3633d6b72' },
      { action: 'update', data: { id: 'shared-entity-id' } },
      'linear'
    )
    expect(key).toBe('wh_linear:234d1a4e-b617-4388-90fe-adc3633d6b72')
  })
})

describe('IdempotencyService in-progress deadlines', () => {
  it('leases a Redis claim until the admitted absolute expiry', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-03T12:00:00.000Z'))
    redisEvalMock.mockResolvedValue([1, ''])
    const inProgressExpiresAt = Date.now() + 60_001
    const service = new IdempotencyService({ forceStorage: 'redis' })

    const claim = await service.atomicallyClaim('provider', 'delivery-1', undefined, {
      inProgressExpiresAt,
    })

    expect(claim.claimToken).toEqual(expect.any(String))
    expect(redisEvalMock).toHaveBeenCalledWith(
      expect.stringContaining("claimed = redis.call('SET'"),
      1,
      'idempotency:default:provider:delivery-1',
      expect.stringMatching(
        new RegExp(`"inProgressExpiresAt":${inProgressExpiresAt}.*"claimToken":".+"`)
      ),
      61
    )
  })

  it('closes the Redis NX-then-expiry race inside one bounded Lua claim', async () => {
    redisEvalMock.mockResolvedValue([1, ''])
    const service = new IdempotencyService({ forceStorage: 'redis' })

    await expect(service.atomicallyClaim('provider', 'delivery-race')).resolves.toMatchObject({
      claimed: true,
      storageMethod: 'redis',
    })

    const script = redisEvalMock.mock.calls[0]?.[0] as string
    expect(script.match(/redis\.call\('SET'/g)).toHaveLength(2)
    expect(script).toContain("current = redis.call('GET', KEYS[1])")
    expect(redisEvalMock).toHaveBeenCalledTimes(1)
  })

  it('finalizes a Redis lease only through an owner-token compare-and-set', async () => {
    redisEvalMock.mockResolvedValueOnce([1, '']).mockResolvedValueOnce(1)
    const service = new IdempotencyService({ forceStorage: 'redis' })
    const claim = await service.atomicallyClaim('provider', 'delivery-redis')

    await expect(
      service.storeResult(
        claim.normalizedKey,
        { success: true, status: 'completed' },
        claim.storageMethod,
        claim.claimToken as string
      )
    ).resolves.toBe(true)

    expect(redisEvalMock).toHaveBeenCalledWith(
      expect.stringContaining('decoded.claimToken ~= ARGV[1]'),
      1,
      'idempotency:default:provider:delivery-redis',
      claim.claimToken,
      604800,
      JSON.stringify({ success: true, status: 'completed', claimToken: claim.claimToken })
    )
  })

  it('does not overwrite a database lease after another owner reclaims it', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ key: 'default:provider:delivery-db' }])
    const service = new IdempotencyService({ forceStorage: 'database' })
    const claim = await service.atomicallyClaim('provider', 'delivery-db')
    dbChainMockFns.returning.mockResolvedValueOnce([])

    await expect(
      service.storeResult(
        claim.normalizedKey,
        { success: true, status: 'completed' },
        claim.storageMethod,
        claim.claimToken as string
      )
    ).resolves.toBe(false)

    expect(dbChainMockFns.update).toHaveBeenCalled()
    expect(dbChainMockFns.insert).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.where).toHaveBeenCalled()
  })

  it('does not apply the completed-result TTL to a still-live database lease', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])
    const service = new IdempotencyService({
      forceStorage: 'database',
      ttlSeconds: 60,
      inProgressTtlSeconds: 120,
    })

    await service.atomicallyClaim('provider', 'long-running-delivery', undefined, {
      inProgressExpiresAt: Date.now() + 120_000,
    })

    const conflictOptions = dbChainMockFns.onConflictDoUpdate.mock.calls[0]?.[0]
    const setWhere = JSON.stringify(conflictOptions?.setWhere)
    expect(setWhere).toContain('json_typeof')
    expect(setWhere).not.toContain('jsonb_typeof')
    expect(setWhere).toContain('IS DISTINCT FROM')
    expect(setWhere).toContain('in-progress')
  })

  it('releases a Redis lease with the same owner-token fence', async () => {
    redisEvalMock.mockResolvedValue(0)
    const service = new IdempotencyService({ forceStorage: 'redis' })

    await service.release('default:provider:delivery-1', 'redis', 'owner-1')

    expect(redisEvalMock).toHaveBeenCalledWith(
      expect.stringContaining('decoded.claimToken ~= ARGV[1]'),
      1,
      'idempotency:default:provider:delivery-1',
      'owner-1'
    )
    expect(redisDelMock).not.toHaveBeenCalled()
  })

  it('fences retryable failed-result deletion to the exact Redis value observed', async () => {
    const failedResult = { success: false, status: 'failed' as const, error: 'retry me' }
    const observedValue = JSON.stringify(failedResult)
    const service = new IdempotencyService({ forceStorage: 'redis', retryFailures: true })
    const claimSpy = vi
      .spyOn(service, 'atomicallyClaim')
      .mockResolvedValueOnce({
        claimed: false,
        existingResult: failedResult,
        normalizedKey: 'default:provider:delivery-retry',
        storageMethod: 'redis',
        observedValue,
      })
      .mockResolvedValueOnce({
        claimed: false,
        existingResult: { success: true, status: 'completed', result: 'new-owner-result' },
        normalizedKey: 'default:provider:delivery-retry',
        storageMethod: 'redis',
      })
    redisEvalMock.mockResolvedValue(0)

    await expect(
      service.executeWithIdempotency('provider', 'delivery-retry', vi.fn())
    ).resolves.toBe('new-owner-result')

    expect(redisEvalMock).toHaveBeenCalledWith(
      expect.stringContaining('current ~= ARGV[1]'),
      1,
      'idempotency:default:provider:delivery-retry',
      observedValue
    )
    expect(claimSpy).toHaveBeenCalledTimes(2)
  })

  it('bounds a webhook lease well under the dedupe window', () => {
    expect(WEBHOOK_IN_PROGRESS_LEASE_SECONDS).toBeGreaterThan(0)
    expect(WEBHOOK_IN_PROGRESS_LEASE_SECONDS).toBeLessThan(SEVEN_DAYS_SECONDS)
  })

  it('leases an untimed webhook claim for the bounded lease, not the seven-day dedupe window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-03T12:00:00.000Z'))
    redisEvalMock.mockResolvedValue([1, ''])

    await webhookIdempotency.atomicallyClaim('gmail', 'wh_1:untimed-delivery')

    const [, , redisKey, serialized, ttlSeconds] = redisEvalMock.mock.calls[0] as [
      string,
      number,
      string,
      string,
      number,
    ]
    expect(redisKey).toBe('idempotency:webhook:gmail:wh_1:untimed-delivery')
    expect(ttlSeconds).toBe(WEBHOOK_IN_PROGRESS_LEASE_SECONDS)
    expect(JSON.parse(serialized).inProgressExpiresAt).toBe(
      Date.now() + WEBHOOK_IN_PROGRESS_LEASE_SECONDS * 1000
    )
  })

  it('keeps the seven-day dedupe window on a completed webhook result', async () => {
    redisEvalMock.mockResolvedValueOnce([1, '']).mockResolvedValueOnce(1)
    const claim = await webhookIdempotency.atomicallyClaim('gmail', 'wh_1:completed-delivery')

    await webhookIdempotency.storeResult(
      claim.normalizedKey,
      { success: true, status: 'completed' },
      'redis',
      claim.claimToken as string
    )

    expect(redisEvalMock.mock.calls[1]?.[4]).toBe(SEVEN_DAYS_SECONDS)
  })

  it('stops a duplicate webhook delivery waiting at the lease, not at the dedupe window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-03T12:00:00.000Z'))
    const startedAt = Date.now() - 1_000
    vi.spyOn(webhookIdempotency, 'atomicallyClaim').mockResolvedValue({
      claimed: false,
      existingResult: { success: false, status: 'in-progress', startedAt },
      normalizedKey: 'webhook:gmail:wh_1:duplicate-delivery',
      storageMethod: 'redis',
    })
    const waitSpy = vi.spyOn(webhookIdempotency, 'waitForResult').mockResolvedValue(undefined)

    await webhookIdempotency.executeWithIdempotency('gmail', 'wh_1:duplicate-delivery', vi.fn())

    const waitUntil = waitSpy.mock.calls[0]?.[2] as number
    expect(waitUntil).toBe(startedAt + WEBHOOK_IN_PROGRESS_LEASE_SECONDS * 1000)
    expect(waitUntil).toBeLessThan(Date.now() + SEVEN_DAYS_SECONDS * 1000)
  })

  it('fences retryable failed-result deletion to the database value observed', async () => {
    const failedResult = { success: false, status: 'failed' as const, error: 'retry me' }
    const service = new IdempotencyService({ forceStorage: 'database', retryFailures: true })
    vi.spyOn(service, 'atomicallyClaim')
      .mockResolvedValueOnce({
        claimed: false,
        existingResult: failedResult,
        normalizedKey: 'default:provider:delivery-retry-db',
        storageMethod: 'database',
      })
      .mockResolvedValueOnce({
        claimed: false,
        existingResult: { success: true, status: 'completed', result: 'new-owner-result' },
        normalizedKey: 'default:provider:delivery-retry-db',
        storageMethod: 'database',
      })
    dbChainMockFns.returning.mockResolvedValueOnce([])

    await expect(
      service.executeWithIdempotency('provider', 'delivery-retry-db', vi.fn())
    ).resolves.toBe('new-owner-result')

    const condition = JSON.stringify(dbChainMockFns.where.mock.calls.at(-1)?.[0])
    expect(condition).toContain('retry me')
    expect(condition.match(/::jsonb/g)).toHaveLength(2)
  })
})

describe('IdempotencyService retryable setup failures', () => {
  it('releases the claim instead of memoizing when the operation throws a RetryableSetupError', async () => {
    redisEvalMock.mockResolvedValueOnce([1, '']).mockResolvedValueOnce(1)

    const setupError = new RetryableSetupError('Internal error while fetching workflow')
    await expect(
      webhookIdempotency.executeWithIdempotency(
        'sim',
        'wh_1:setup-failure',
        vi.fn().mockRejectedValue(setupError)
      )
    ).rejects.toBe(setupError)

    const claimSerialized = JSON.parse((redisEvalMock.mock.calls[0] as unknown[])[3] as string)
    const followUpCall = redisEvalMock.mock.calls[1] as unknown[]
    // The follow-up must be the owner-fenced DELETE (release), not the failed-result store.
    expect(followUpCall[0]).toContain("return redis.call('DEL', KEYS[1])")
    expect(followUpCall[3]).toBe(claimSerialized.claimToken)
  })

  it('memoizes plain operation failures so duplicate deliveries stay rejected', async () => {
    redisEvalMock.mockResolvedValueOnce([1, '']).mockResolvedValueOnce(1)

    await expect(
      webhookIdempotency.executeWithIdempotency(
        'sim',
        'wh_1:plain-failure',
        vi.fn().mockRejectedValue(new Error('handler blew up'))
      )
    ).rejects.toThrow('handler blew up')

    const followUpCall = redisEvalMock.mock.calls[1] as unknown[]
    expect(followUpCall[0]).toContain('SETEX')
    expect(JSON.parse(followUpCall[5] as string)).toMatchObject({
      success: false,
      status: 'failed',
    })
  })
})
