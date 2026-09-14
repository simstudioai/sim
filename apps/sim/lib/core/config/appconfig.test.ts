/**
 * @vitest-environment node
 */
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

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))

let counter = 0
/** Unique identifiers per test so the module-level cache never bleeds across tests. */
function uniqueIds() {
  counter += 1
  return { application: `app-${counter}`, environment: `env-${counter}`, profile: 'access-control' }
}

describe('fetchAppConfigProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts a session then returns the parsed configuration', async () => {
    mockSend.mockImplementation((command: { __type: string }) => {
      if (command.__type === 'start') return Promise.resolve({ InitialConfigurationToken: 'tok-1' })
      return Promise.resolve({
        Configuration: encode({ blockedSignupDomains: ['spam.example'] }),
        NextPollConfigurationToken: 'tok-2',
      })
    })

    const result = await fetchAppConfigProfile(
      uniqueIds(),
      (json) => json as Record<string, unknown>
    )
    expect(result).toEqual({ blockedSignupDomains: ['spam.example'] })

    const sentTypes = mockSend.mock.calls.map(([c]) => c.__type)
    expect(sentTypes).toEqual(['start', 'get'])
  })

  it('returns null when the cold fetch fails (never throws)', async () => {
    mockSend.mockRejectedValue(new Error('appconfig down'))
    const result = await fetchAppConfigProfile(uniqueIds(), (json) => json)
    expect(result).toBeNull()
  })

  it('applies the parse function to the decoded JSON', async () => {
    mockSend.mockImplementation((command: { __type: string }) => {
      if (command.__type === 'start') return Promise.resolve({ InitialConfigurationToken: 'tok-1' })
      return Promise.resolve({
        Configuration: encode({ count: 2 }),
        NextPollConfigurationToken: 'tok-2',
      })
    })

    const result = await fetchAppConfigProfile(
      uniqueIds(),
      (json) => (json as { count: number }).count * 10
    )
    expect(result).toBe(20)
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
    vi.clearAllMocks()
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
