/**
 * The shared AppConfig snapshot against real Redis: a long-lived process publishes what it polled,
 * a fresh Trigger.dev run process adopts it without an AppConfig session, and an older snapshot
 * never replaces a newer one. Skipped without `TEST_REDIS_URL`.
 */
import { readTestRedisUrl } from '@sim/db/testing/test-infrastructure'
import { redisConfigMock, redisConfigMockFns } from '@sim/testing/mocks/redis-config.mock'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import Redis from 'ioredis'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  markInsideTriggerRun,
  resetInsideTriggerRunForTests,
} from '@/lib/core/config/trigger-runtime'

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }))

vi.mock('@/lib/core/config/redis', () => redisConfigMock)
vi.mock('@aws-sdk/client-appconfigdata', () => ({
  AppConfigDataClient: class {
    send = mockSend
  },
  StartConfigurationSessionCommand: class {
    __type = 'start'
  },
  GetLatestConfigurationCommand: class {
    __type = 'get'
  },
}))

const redisUrl = readTestRedisUrl()

/** Each import is a separate process's module-level cache. */
async function freshProcess() {
  vi.resetModules()
  return import('@/lib/core/config/appconfig')
}

function respondWith(revision: string) {
  mockSend.mockImplementation((command: { __type: string }) =>
    Promise.resolve(
      command.__type === 'start'
        ? { InitialConfigurationToken: 'token' }
        : {
            Configuration: new TextEncoder().encode(JSON.stringify({ revision })),
            NextPollConfigurationToken: 'next',
          }
    )
  )
}

describe.runIf(Boolean(redisUrl))('shared AppConfig snapshot with Redis', () => {
  let redis: Redis
  let ids: { application: string; environment: string; profile: string }
  const key = () => `appconfig:snapshot:v1:${ids.application}/${ids.environment}/${ids.profile}`

  async function waitForPublished(revision: string) {
    for (let attempt = 0; attempt < 50; attempt++) {
      const stored = await redis.get(key())
      if (stored?.includes(revision)) return
      await sleep(20)
    }
    throw new Error(`snapshot ${revision} was never published`)
  }

  beforeAll(async () => {
    if (!redisUrl) throw new Error('TEST_REDIS_URL is required for this suite')
    redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 0 })
    await redis.connect()
  })

  beforeEach(() => {
    ids = { application: generateId(), environment: 'integration', profile: 'feature-flags' }
    redisConfigMockFns.mockGetRedisClient.mockReturnValue(redis)
  })

  afterEach(async () => {
    resetInsideTriggerRunForTests()
    await redis.del(key())
  })

  afterAll(async () => {
    await redis?.quit()
  })

  it('lets a Trigger.dev run adopt what an app process polled, with no AppConfig session', async () => {
    respondWith('polled')
    const app = await freshProcess()
    expect(
      await app.fetchAppConfigProfile(ids, (json) => json, { shareWithTriggerRuns: true })
    ).toEqual({ revision: 'polled' })
    await waitForPublished('polled')

    mockSend.mockClear()
    markInsideTriggerRun()
    const run = await freshProcess()
    expect(
      await run.fetchAppConfigProfile(ids, (json) => json, { shareWithTriggerRuns: true })
    ).toEqual({ revision: 'polled' })
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('keeps a newer snapshot when a process that polled earlier publishes', async () => {
    const newer = { raw: JSON.stringify({ revision: 'newer' }), validatedAt: Date.now() + 60_000 }
    await redis.set(key(), JSON.stringify(newer))

    respondWith('older')
    const publish = vi.spyOn(redis, 'eval')
    const app = await freshProcess()
    expect(
      await app.fetchAppConfigProfile(ids, (json) => json, { shareWithTriggerRuns: true })
    ).toEqual({ revision: 'older' })
    await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(1))
    expect(await publish.mock.results[0]?.value).toBe(0)

    expect(JSON.parse((await redis.get(key())) ?? 'null')).toEqual(newer)
  })
})
