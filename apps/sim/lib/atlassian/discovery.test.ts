/**
 * @vitest-environment node
 */
import { createMockResponse } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AtlassianSiteNotMatchedError,
  clearAtlassianCloudIdCache,
  normalizeAtlassianSiteUrl,
  resolveAtlassianCloudId,
} from '@/lib/atlassian/discovery'

const SITE = 'https://acme.atlassian.net'
const CLOUD_ID = 'cloud-abc'

/** Options for the site under test; override only the field a case is exercising. */
function options(over: Record<string, unknown> = {}) {
  return { domain: 'acme.atlassian.net', accessToken: 't', product: 'Jira', ...over } as Parameters<
    typeof resolveAtlassianCloudId
  >[0]
}

/** Tiny waits keep retry cases fast; the explicit budget absorbs test-runner scheduling latency. */
const FAST = { initialDelayMs: 1, maxDelayMs: 1, retryBudgetMs: 1_000 }

function sites(entries: Array<{ id: string; url: string }>) {
  return createMockResponse({ json: entries })
}

function failure(status: number, body: unknown = { key: 'unexpectedError' }) {
  return createMockResponse({ status, json: body })
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  clearAtlassianCloudIdCache()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('normalizeAtlassianSiteUrl', () => {
  it.each([
    ['acme.atlassian.net', SITE],
    ['https://acme.atlassian.net', SITE],
    ['http://ACME.atlassian.net/', SITE],
    ['  acme.atlassian.net//  ', SITE],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeAtlassianSiteUrl(input)).toBe(expected)
  })
})

describe('resolveAtlassianCloudId', () => {
  it('rejects the sole other site when exact matching is required', async () => {
    fetchMock.mockResolvedValue(sites([{ id: 'other-cloud', url: 'https://other.atlassian.net' }]))

    await expect(
      resolveAtlassianCloudId(options({ requireExactMatch: true }))
    ).rejects.toBeInstanceOf(AtlassianSiteNotMatchedError)
  })

  it('does not reuse a fallback answer for an exact-match request', async () => {
    fetchMock.mockResolvedValue(sites([{ id: 'other-cloud', url: 'https://other.atlassian.net' }]))

    await expect(resolveAtlassianCloudId(options())).resolves.toBe('other-cloud')
    await expect(
      resolveAtlassianCloudId(options({ requireExactMatch: true }))
    ).rejects.toBeInstanceOf(AtlassianSiteNotMatchedError)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('caches matching exact-site requests separately and preserves domain normalization', async () => {
    fetchMock.mockResolvedValue(sites([{ id: CLOUD_ID, url: SITE }]))
    const exact = options({ requireExactMatch: true, domain: ' HTTP://ACME.ATLASSIAN.NET// ' })

    await expect(resolveAtlassianCloudId(exact)).resolves.toBe(CLOUD_ID)
    await expect(resolveAtlassianCloudId(exact)).resolves.toBe(CLOUD_ID)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('resolves an exact domain match', async () => {
    fetchMock.mockResolvedValue(sites([{ id: CLOUD_ID, url: SITE }]))

    await expect(resolveAtlassianCloudId(options())).resolves.toBe(CLOUD_ID)
  })

  it('serves a repeat lookup from cache without a second request', async () => {
    fetchMock.mockResolvedValue(sites([{ id: CLOUD_ID, url: SITE }]))

    await resolveAtlassianCloudId(options())
    await resolveAtlassianCloudId(options())

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('collapses concurrent lookups into one request', async () => {
    fetchMock.mockResolvedValue(sites([{ id: CLOUD_ID, url: SITE }]))

    const resolved = await Promise.all([
      resolveAtlassianCloudId(options()),
      resolveAtlassianCloudId(options()),
      resolveAtlassianCloudId(options()),
    ])

    expect(resolved).toEqual([CLOUD_ID, CLOUD_ID, CLOUD_ID])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([500, 503, 507])(
    'retries a %i and succeeds, instead of failing the call',
    async (status) => {
      fetchMock
        .mockResolvedValueOnce(failure(status))
        .mockResolvedValueOnce(sites([{ id: CLOUD_ID, url: SITE }]))

      await expect(resolveAtlassianCloudId(options({ retryOptions: FAST }))).resolves.toBe(CLOUD_ID)
    }
  )

  it('keeps the transient-5xx condition when a caller tunes the retry budget', async () => {
    fetchMock
      .mockResolvedValueOnce(failure(500))
      .mockResolvedValueOnce(sites([{ id: CLOUD_ID, url: SITE }]))

    // Shaped like VALIDATE_RETRY_OPTIONS: counts only, no retryCondition.
    await expect(
      resolveAtlassianCloudId(options({ retryOptions: { maxRetries: 3, ...FAST } }))
    ).resolves.toBe(CLOUD_ID)
  })

  it('gives up on a persistent fault within a bounded attempt budget', async () => {
    fetchMock.mockImplementation(async () => failure(500))

    await expect(resolveAtlassianCloudId(options({ retryOptions: FAST }))).rejects.toThrow(
      /Failed to fetch Jira accessible resources: 500/
    )
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('does not retry a client error', async () => {
    fetchMock.mockResolvedValue(failure(403, { message: 'nope' }))

    await expect(resolveAtlassianCloudId(options({ retryOptions: FAST }))).rejects.toThrow(
      /Failed to fetch Jira accessible resources: 403/
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not pin a failure in the cache', async () => {
    fetchMock.mockResolvedValueOnce(failure(403, { message: 'nope' }))
    await expect(resolveAtlassianCloudId(options({ retryOptions: FAST }))).rejects.toThrow()

    fetchMock.mockResolvedValueOnce(sites([{ id: CLOUD_ID, url: SITE }]))
    await expect(resolveAtlassianCloudId(options())).resolves.toBe(CLOUD_ID)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('surfaces a non-OK status rather than reporting no resources', async () => {
    fetchMock.mockImplementation(async () => failure(500))

    await expect(
      resolveAtlassianCloudId(options({ product: 'Confluence', retryOptions: FAST }))
    ).rejects.toThrow(/Failed to fetch Confluence accessible resources: 500/)
  })

  it('does not serve one credential answer to another', async () => {
    fetchMock
      .mockResolvedValueOnce(sites([{ id: 'token-a-cloud', url: SITE }]))
      .mockResolvedValueOnce(sites([{ id: 'token-b-cloud', url: SITE }]))

    await expect(resolveAtlassianCloudId(options({ accessToken: 'a' }))).resolves.toBe(
      'token-a-cloud'
    )
    await expect(resolveAtlassianCloudId(options({ accessToken: 'b' }))).resolves.toBe(
      'token-b-cloud'
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not let a concurrent caller inherit another credential lookup', async () => {
    // Token A sees only a different site, so it falls back; token B matches exactly.
    // Joining A's in-flight promise would hand B the wrong site.
    fetchMock
      .mockResolvedValueOnce(sites([{ id: 'a-only-cloud', url: 'https://other.atlassian.net' }]))
      .mockResolvedValueOnce(sites([{ id: CLOUD_ID, url: SITE }]))

    const [a, b] = await Promise.all([
      resolveAtlassianCloudId(options({ accessToken: 'a' })),
      resolveAtlassianCloudId(options({ accessToken: 'b' })),
    ])

    expect(a).toBe('a-only-cloud')
    expect(b).toBe(CLOUD_ID)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries a request that timed out', async () => {
    fetchMock
      .mockRejectedValueOnce(
        Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' })
      )
      .mockResolvedValueOnce(sites([{ id: CLOUD_ID, url: SITE }]))

    await expect(resolveAtlassianCloudId(options({ retryOptions: FAST }))).resolves.toBe(CLOUD_ID)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects rather than throwing synchronously on a missing domain', async () => {
    const call = resolveAtlassianCloudId(options({ domain: undefined }))

    await expect(call).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports the available sites when several are accessible and none match', async () => {
    fetchMock.mockResolvedValue(
      sites([
        { id: 'a', url: 'https://one.atlassian.net' },
        { id: 'b', url: 'https://two.atlassian.net' },
      ])
    )

    await expect(resolveAtlassianCloudId(options())).rejects.toThrow(
      /Available sites: https:\/\/one.atlassian.net, https:\/\/two.atlassian.net/
    )
  })

  it('rejects when the token can see no sites', async () => {
    fetchMock.mockResolvedValue(sites([]))

    await expect(resolveAtlassianCloudId(options())).rejects.toThrow(
      'No Jira sites are accessible to this credential. Reconnect the credential and grant access to the configured Atlassian site.'
    )
  })

  it('distinguishes a malformed discovery payload from an empty site grant', async () => {
    fetchMock.mockResolvedValue(createMockResponse({ json: { id: CLOUD_ID, url: SITE } }))

    await expect(resolveAtlassianCloudId(options())).rejects.toThrow(
      'Invalid Jira accessible-resources response'
    )
  })

  it.each([
    [{ url: SITE }],
    [{ id: CLOUD_ID }],
    [{ id: '', url: SITE }],
    [{ id: CLOUD_ID, url: '' }],
    [null],
  ])('rejects malformed resource entries in an otherwise valid array', async (resources) => {
    fetchMock.mockResolvedValue(createMockResponse({ json: resources }))

    await expect(resolveAtlassianCloudId(options())).rejects.toThrow(
      'Invalid Jira accessible-resources response'
    )
  })
})
