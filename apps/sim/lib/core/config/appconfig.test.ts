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
})
