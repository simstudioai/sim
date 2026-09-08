/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }))
vi.mock('@/lib/core/rate-limiter/provider-capacity-store', () => ({
  mutateProviderCapacity: mutate,
}))

import {
  type ProviderCapacityAction,
  type ProviderCapacityConfig,
  type ProviderCapacityState,
  updateProviderCapacity,
} from '@/lib/core/rate-limiter/provider-capacity-state'
import { githubConnector } from '@/connectors/github/github'

const START = 1_800_000_000_000
const RESET = START + 3_600_000
const SOURCE = { repository: 'owner/repository', branch: 'main' }

describe('GitHub sync progress with shared low-quota pacing', () => {
  const states = new Map<string, ProviderCapacityState>()
  let allowance = 100
  let requests = 0
  let requestPaths: string[] = []

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(START)
    states.clear()
    requests = 0
    allowance = 100
    requestPaths = []
    mutate.mockImplementation(
      async (key: string, config: ProviderCapacityConfig, action: ProviderCapacityAction) => {
        const update = updateProviderCapacity(states.get(key) ?? null, config, action, Date.now())
        states.set(key, update.state)
        return update.result
      }
    )
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input)
      requestPaths.push(url.pathname)
      requests++
      const headers = {
        'x-ratelimit-remaining': String(allowance - requests),
        'x-ratelimit-reset': String((Date.now() >= RESET ? RESET + 3_600_000 : RESET) / 1000),
      }
      if (url.pathname.includes('/git/trees/'))
        return Response.json(
          {
            sha: 'tree-sha',
            truncated: false,
            tree: [{ path: 'guide.md', sha: 'blob-sha', size: 4, mode: '100644', type: 'blob' }],
          },
          { headers }
        )
      if (url.pathname.includes('/contents/'))
        return Response.json(
          {
            sha: 'blob-sha',
            size: 4,
            content: 'dGV4dA==',
            encoding: 'base64',
          },
          { headers }
        )
      throw new Error('Unexpected fixture endpoint')
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const sync = async () => {
    const context = {}
    const listing = await githubConnector.listDocuments('fixture-token', SOURCE, undefined, context)
    return githubConnector.getDocument(
      'fixture-token',
      SOURCE,
      listing.documents[0].externalId,
      context
    )
  }

  it('reaches hydration in successive fresh sync contexts instead of repeatedly spending quota on trees', async () => {
    for (let pass = 0; pass < 2; pass++) {
      const pending = sync()
      await vi.advanceTimersByTimeAsync(125_000)
      expect(await pending).toMatchObject({ content: 'text' })
    }
    expect(requestPaths).toEqual([
      '/repos/owner/repository/git/trees/main',
      '/repos/owner/repository/contents/guide.md',
      '/repos/owner/repository/git/trees/main',
      '/repos/owner/repository/contents/guide.md',
    ])
  })

  it('defers a second worker immediately during a known cooldown instead of waiting its ordinary pacing budget', async () => {
    const provider = vi.fn(async () =>
      Response.json({ message: 'You have exceeded a secondary rate limit.' }, { status: 403 })
    )
    vi.stubGlobal('fetch', provider)
    await expect(sync()).rejects.toMatchObject({ rateLimited: true, retryAfterMs: 120_000 })
    await expect(sync()).rejects.toMatchObject({ rateLimited: true, retryAfterMs: 120_000 })
    expect(provider).toHaveBeenCalledOnce()
    expect(Date.now()).toBe(START)
  })

  it('defers extremely low allowance until reset without replaying bootstrap at every pacing interval', async () => {
    allowance = 10
    const first = expect(sync()).rejects.toMatchObject({
      name: 'GitHubRequestDeferredError',
      retryAfterMs: 3_601_000,
    })
    await vi.advanceTimersByTimeAsync(1)
    await first
    expect(requests).toBe(1)

    vi.setSystemTime(START + 450_000)
    const replay = expect(sync()).rejects.toMatchObject({
      name: 'GitHubRequestDeferredError',
      retryAfterMs: 3_151_000,
    })
    await vi.advanceTimersByTimeAsync(1)
    await replay
    expect(requests).toBe(1)

    vi.setSystemTime(RESET + 1001)
    allowance = 100
    const resumed = sync()
    await vi.advanceTimersByTimeAsync(125_000)
    expect(await resumed).toMatchObject({ content: 'text' })
    expect(requests).toBe(3)
  })
})
