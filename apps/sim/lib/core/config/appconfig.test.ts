import { flushMacrotask } from '@sim/testing/helpers/async'
import { redisConfigMockFns } from '@sim/testing/mocks/redis-config.mock'
import { toRecord } from '@sim/utils/object'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
}))

vi.mock('@aws-sdk/client-appconfigdata', () => ({
  AppConfigDataClient: class {
    send = mockSend
  },
  StartConfigurationSessionCommand: class {
    __type = 'start'
    constructor(public input: unknown) {}
  },
  GetLatestConfigurationCommand: class {
    __type = 'get'
    constructor(public input: unknown) {}
  },
}))

import { fetchAppConfigProfile, fetchAppConfigSnapshot } from '@/lib/core/config/appconfig'
import {
  markInsideTriggerRun,
  resetInsideTriggerRunForTests,
} from '@/lib/core/config/trigger-runtime'

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))

let counter = 0
/** Unique identifiers per test so the module-level cache never bleeds across tests. */
function uniqueIds() {
  counter += 1
  return { application: `app-${counter}`, environment: `env-${counter}`, profile: 'access-control' }
}

describe('fetchAppConfigProfile', () => {
  it('returns null when the cold fetch fails (never throws)', async () => {
    mockSend.mockRejectedValue(new Error('appconfig down'))
    const result = await fetchAppConfigProfile(uniqueIds(), (json) => json)
    expect(result).toBeNull()
  })

  it('warms the cache on an empty payload and does not re-poll (unseeded profile)', async () => {
    mockSend.mockImplementation((command: { __type: string }) => {
      if (command.__type === 'start') return Promise.resolve({ InitialConfigurationToken: 'tok-1' })
      return Promise.resolve({
        Configuration: new Uint8Array(),
        NextPollConfigurationToken: 'tok-2',
        NextPollIntervalInSeconds: 60,
      })
    })

    const ids = uniqueIds()
    expect(await fetchAppConfigProfile(ids, (json) => json)).toBeNull()
    const callsAfterFirst = mockSend.mock.calls.length

    expect(await fetchAppConfigProfile(ids, (json) => json)).toBeNull()
    expect(mockSend.mock.calls.length).toBe(callsAfterFirst)
  })

  it('keeps the session on a parse error (no re-StartConfigurationSession, no throw)', async () => {
    mockSend.mockImplementation((command: { __type: string }) => {
      if (command.__type === 'start') return Promise.resolve({ InitialConfigurationToken: 'tok-1' })
      return Promise.resolve({
        Configuration: new TextEncoder().encode('not json{'),
        NextPollConfigurationToken: 'tok-2',
        NextPollIntervalInSeconds: 60,
      })
    })

    const ids = uniqueIds()
    expect(await fetchAppConfigProfile(ids, (json) => json)).toBeNull()

    // Network round trip succeeded, so exactly one session was started despite the
    // parse failure — the rotated token was preserved, not discarded.
    expect(mockSend.mock.calls.filter(([c]) => c.__type === 'start')).toHaveLength(1)
  })

  it('dedupes concurrent cold fetches into a single poll', async () => {
    mockSend.mockImplementation((command: { __type: string }) => {
      if (command.__type === 'start') return Promise.resolve({ InitialConfigurationToken: 'tok-1' })
      return Promise.resolve({
        Configuration: encode({ x: 1 }),
        NextPollConfigurationToken: 'tok-2',
      })
    })

    const ids = uniqueIds()
    const [a, b] = await Promise.all([
      fetchAppConfigProfile(ids, (json) => json),
      fetchAppConfigProfile(ids, (json) => json),
    ])

    expect(a).toEqual({ x: 1 })
    expect(b).toEqual({ x: 1 })
    expect(mockSend.mock.calls.map(([c]) => c.__type)).toEqual(['start', 'get'])
  })

  it('honors the server poll interval and serves warm values during one shared refresh', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    try {
      mockSend.mockImplementation((command: { __type: string }) =>
        Promise.resolve(
          command.__type === 'start'
            ? { InitialConfigurationToken: 'token' }
            : {
                Configuration: encode({ revision: 'first' }),
                NextPollConfigurationToken: 'next',
                NextPollIntervalInSeconds: 60,
              }
        )
      )
      const ids = uniqueIds()
      const parse = (value: unknown) => value
      expect(await fetchAppConfigProfile(ids, parse)).toEqual({ revision: 'first' })
      vi.setSystemTime(130_001)
      await fetchAppConfigProfile(ids, parse)
      expect(mockSend).toHaveBeenCalledTimes(2)

      let finish: (value: unknown) => void = () => {}
      mockSend.mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve
        })
      )
      vi.setSystemTime(161_000)
      expect(
        await Promise.all([fetchAppConfigProfile(ids, parse), fetchAppConfigProfile(ids, parse)])
      ).toEqual([{ revision: 'first' }, { revision: 'first' }])
      expect(mockSend).toHaveBeenCalledTimes(3)
      finish({ Configuration: encode({ revision: 'second' }), NextPollConfigurationToken: 'next' })
      await vi.waitFor(async () => {
        expect(await fetchAppConfigProfile(ids, parse)).toEqual({ revision: 'second' })
      })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('fetchAppConfigSnapshot freshness', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
  })
  afterEach(() => vi.useRealTimers())

  it('evicts old profiles and requires fresh evidence when they are requested again', async () => {
    mockSend.mockImplementation((command: { __type: string }) =>
      Promise.resolve(
        command.__type === 'start'
          ? { InitialConfigurationToken: 'token' }
          : { Configuration: encode({ revision: 'valid' }), NextPollConfigurationToken: 'next' }
      )
    )
    const oldest = uniqueIds()
    await fetchAppConfigSnapshot(oldest, (value) => value)
    const results = await Promise.all(
      Array.from({ length: 65 }, () => fetchAppConfigSnapshot(uniqueIds(), (value) => value))
    )
    expect(results.every((result) => result.value !== null)).toBe(true)
    mockSend.mockRejectedValueOnce(new Error('unavailable'))
    expect(await fetchAppConfigSnapshot(oldest, (value) => value)).toEqual({
      value: null,
      validatedAt: null,
    })
    expect(mockSend.mock.calls.at(-1)?.[0].__type).toBe('start')
  })

  it('does not turn an empty first response or a cold failure into a valid snapshot', async () => {
    mockSend.mockRejectedValueOnce(new Error('unavailable'))
    expect(await fetchAppConfigSnapshot(uniqueIds(), (value) => value)).toEqual({
      value: null,
      validatedAt: null,
    })
    mockSend.mockImplementation((command: { __type: string }) =>
      Promise.resolve(
        command.__type === 'start'
          ? { InitialConfigurationToken: 'token' }
          : { Configuration: new Uint8Array(), NextPollConfigurationToken: 'next' }
      )
    )
    expect(await fetchAppConfigSnapshot(uniqueIds(), (value) => value)).toEqual({
      value: null,
      validatedAt: null,
    })
  })

  it('does not renew an old snapshot after a rejected revision followed by unchanged polls', async () => {
    let payload = encode({ revision: 'valid' })
    mockSend.mockImplementation((command: { __type: string }) =>
      Promise.resolve(
        command.__type === 'start'
          ? { InitialConfigurationToken: 'token' }
          : {
              Configuration: payload,
              NextPollConfigurationToken: 'next',
              NextPollIntervalInSeconds: 30,
            }
      )
    )
    const ids = uniqueIds()
    const parse = (value: unknown) => value
    const first = await fetchAppConfigSnapshot(ids, parse)
    expect(first.validatedAt).toBe(100_000)
    payload = new TextEncoder().encode('invalid json')
    vi.setSystemTime(130_001)
    expect(await fetchAppConfigSnapshot(ids, parse)).toEqual(first)
    payload = new Uint8Array()
    vi.setSystemTime(160_002)
    expect(await fetchAppConfigSnapshot(ids, parse)).toEqual(first)
    payload = encode({ revision: 'replacement' })
    vi.setSystemTime(190_003)
    expect(await fetchAppConfigSnapshot(ids, parse)).toEqual({
      value: { revision: 'replacement' },
      validatedAt: 190_003,
    })
  })

  it('renews a validated unchanged revision and deduplicates due polls', async () => {
    let payload = encode({ revision: 'valid' })
    mockSend.mockImplementation((command: { __type: string }) =>
      Promise.resolve(
        command.__type === 'start'
          ? { InitialConfigurationToken: 'token' }
          : {
              Configuration: payload,
              NextPollConfigurationToken: 'next',
              NextPollIntervalInSeconds: 30,
            }
      )
    )
    const ids = uniqueIds()
    const parse = (value: unknown) => value
    await fetchAppConfigSnapshot(ids, parse)
    payload = new Uint8Array()
    vi.setSystemTime(130_001)
    const results = await Promise.all([
      fetchAppConfigSnapshot(ids, parse),
      fetchAppConfigSnapshot(ids, parse),
    ])
    expect(results[0].validatedAt).toBe(130_001)
    expect(results[1]).toEqual(results[0])
    expect(mockSend.mock.calls).toHaveLength(3)
  })
})

describe('shared snapshot in Trigger.dev runs', () => {
  const shared = { shareWithTriggerRuns: true }
  const sessionResponses = (command: { __type: string }) =>
    Promise.resolve(
      command.__type === 'start'
        ? { InitialConfigurationToken: 'token' }
        : { Configuration: encode({ revision: 'appconfig' }), NextPollConfigurationToken: 'next' }
    )
  const snapshotAt = (validatedAt: number) =>
    JSON.stringify({ raw: JSON.stringify({ revision: 'shared' }), validatedAt })
  const redisReturning = (stored: string | null) => {
    const redis = { get: vi.fn().mockResolvedValue(stored), eval: vi.fn().mockResolvedValue(1) }
    redisConfigMockFns.mockGetRedisClient.mockReturnValue(redis)
    return redis
  }

  beforeEach(() => {
    mockSend.mockImplementation(sessionResponses)
    markInsideTriggerRun()
  })
  afterEach(() => resetInsideTriggerRunForTests())

  it('adopts a fresh snapshot without opening an AppConfig session', async () => {
    redisReturning(snapshotAt(Date.now()))
    expect(await fetchAppConfigProfile(uniqueIds(), (json) => json, shared)).toEqual({
      revision: 'shared',
    })
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('tolerates a publisher clock a few seconds ahead, but not more', async () => {
    redisReturning(snapshotAt(Date.now() + 4_000))
    expect(await fetchAppConfigProfile(uniqueIds(), (json) => json, shared)).toEqual({
      revision: 'shared',
    })
    redisReturning(snapshotAt(Date.now() + 60_000))
    expect(await fetchAppConfigProfile(uniqueIds(), (json) => json, shared)).toEqual({
      revision: 'appconfig',
    })
  })

  it('never reads the snapshot outside a Trigger.dev run', async () => {
    resetInsideTriggerRunForTests()
    redisReturning(snapshotAt(Date.now()))
    expect(await fetchAppConfigProfile(uniqueIds(), (json) => json, shared)).toEqual({
      revision: 'appconfig',
    })
  })

  it('never reads or publishes a profile that did not opt in', async () => {
    const redis = redisReturning(snapshotAt(Date.now()))
    expect(await fetchAppConfigProfile(uniqueIds(), (json) => json)).toEqual({
      revision: 'appconfig',
    })
    resetInsideTriggerRunForTests()
    await fetchAppConfigProfile(uniqueIds(), (json) => json)
    await flushMacrotask()
    expect(redis.eval).not.toHaveBeenCalled()
  })

  it('polls AppConfig when the snapshot is older than the adoption window', async () => {
    redisReturning(snapshotAt(Date.now() - 120_000))
    expect(await fetchAppConfigProfile(uniqueIds(), (json) => json, shared)).toEqual({
      revision: 'appconfig',
    })
  })

  it('polls AppConfig when Redis fails or the snapshot does not parse', async () => {
    redisConfigMockFns.mockGetRedisClient.mockReturnValue({
      get: vi.fn().mockRejectedValue(new Error('redis down')),
      eval: vi.fn().mockRejectedValue(new Error('redis down')),
    })
    expect(await fetchAppConfigProfile(uniqueIds(), (json) => json, shared)).toEqual({
      revision: 'appconfig',
    })

    redisReturning(snapshotAt(Date.now()))
    const rejectShared = (json: unknown) => {
      if (toRecord(json).revision === 'shared') throw new Error('invalid')
      return json
    }
    expect(await fetchAppConfigProfile(uniqueIds(), rejectShared, shared)).toEqual({
      revision: 'appconfig',
    })
  })

  it('publishes only from app processes', async () => {
    const redis = redisReturning(null)
    expect(await fetchAppConfigProfile(uniqueIds(), (json) => json, shared)).toEqual({
      revision: 'appconfig',
    })
    await flushMacrotask()
    expect(redis.eval).not.toHaveBeenCalled()

    resetInsideTriggerRunForTests()
    await fetchAppConfigProfile(uniqueIds(), (json) => json, shared)
    await vi.waitFor(() => expect(redis.eval).toHaveBeenCalledTimes(1))
  })

  it('never serves or publishes a strict snapshot through the shared copy', async () => {
    const redis = redisReturning(snapshotAt(Date.now()))
    expect((await fetchAppConfigSnapshot(uniqueIds(), (json) => json)).value).toEqual({
      revision: 'appconfig',
    })
    resetInsideTriggerRunForTests()
    await fetchAppConfigSnapshot(uniqueIds(), (json) => json)
    await flushMacrotask()
    expect(redis.eval).not.toHaveBeenCalled()
  })
})
