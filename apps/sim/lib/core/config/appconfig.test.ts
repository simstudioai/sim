/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

import { fetchAppConfigProfile } from '@/lib/core/config/appconfig'

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
})
