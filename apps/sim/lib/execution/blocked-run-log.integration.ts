/**
 * The blocked-run log claim against a real Redis: concurrent refusals from several app
 * instances must agree on exactly one row per workflow, gate, and window. Skipped without
 * `TEST_REDIS_URL`. Each test claims a fresh workflow id, so no test sees another's key.
 */

import { readTestRedisUrl } from '@sim/db/testing/test-infrastructure'
import { redisConfigMock, redisConfigMockFns } from '@sim/testing/mocks/redis-config.mock'
import { generateId } from '@sim/utils/id'
import Redis from 'ioredis'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const redisUrl = readTestRedisUrl()

vi.mock('@/lib/core/config/redis', () => redisConfigMock)

import { BLOCKED_RUN_LOG_WINDOW_SECONDS, claimBlockedRunLog } from '@/lib/execution/blocked-run-log'

describe.runIf(Boolean(redisUrl))('blocked-run log claim', () => {
  let redis: Redis
  const workflowIds: string[] = []

  const freshWorkflowId = () => {
    const workflowId = `workflow-${generateId()}`
    workflowIds.push(workflowId)
    return workflowId
  }

  beforeAll(async () => {
    if (!redisUrl) throw new Error('TEST_REDIS_URL is required for this suite')
    redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 0 })
    await redis.connect()
  })

  beforeEach(() => {
    redisConfigMockFns.mockGetRedisClient.mockReturnValue(redis)
  })

  afterAll(async () => {
    const keys = await Promise.all(
      workflowIds.map((workflowId) => redis.keys(`blocked-run-log:v1:${workflowId}:*`))
    )
    const flat = keys.flat()
    if (flat.length > 0) await redis.del(...flat)
    await redis.quit()
  })

  it('grants exactly one of many concurrent refusals the row', async () => {
    const workflowId = freshWorkflowId()

    const claims = await Promise.all(
      Array.from({ length: 25 }, () => claimBlockedRunLog(workflowId, 'USAGE_LIMIT_EXCEEDED'))
    )

    expect(claims.filter(Boolean)).toHaveLength(1)
  })

  it('grants a different gate its own row in the same window', async () => {
    const workflowId = freshWorkflowId()

    expect(await claimBlockedRunLog(workflowId, 'USAGE_LIMIT_EXCEEDED')).toBe(true)
    expect(await claimBlockedRunLog(workflowId, 'ACCOUNT_SUSPENDED')).toBe(true)
    expect(await claimBlockedRunLog(workflowId, 'USAGE_LIMIT_EXCEEDED')).toBe(false)
  })

  it('expires the claim at the end of the window', async () => {
    const workflowId = freshWorkflowId()
    await claimBlockedRunLog(workflowId, 'USAGE_LIMIT_EXCEEDED')

    const ttl = await redis.ttl(`blocked-run-log:v1:${workflowId}:USAGE_LIMIT_EXCEEDED`)
    expect(ttl).toBeGreaterThan(BLOCKED_RUN_LOG_WINDOW_SECONDS - 5)
    expect(ttl).toBeLessThanOrEqual(BLOCKED_RUN_LOG_WINDOW_SECONDS)

    await redis.expire(`blocked-run-log:v1:${workflowId}:USAGE_LIMIT_EXCEEDED`, 1)
    await vi.waitFor(
      async () => expect(await claimBlockedRunLog(workflowId, 'USAGE_LIMIT_EXCEEDED')).toBe(true),
      { timeout: 3000, interval: 200 }
    )
  })

  it('records the row when Redis fails', async () => {
    const broken = new Redis('redis://127.0.0.1:1', {
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
    })
    redisConfigMockFns.mockGetRedisClient.mockReturnValue(broken)

    expect(await claimBlockedRunLog(freshWorkflowId(), 'USAGE_LIMIT_EXCEEDED')).toBe(true)
    broken.disconnect()
  })
})
