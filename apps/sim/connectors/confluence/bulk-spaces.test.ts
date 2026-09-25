import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { confluenceConnector } from '@/connectors/confluence/confluence'

const fetchMock = vi.fn<typeof fetch>()
const config = { domain: 'example.atlassian.net', spaceKey: [] as string[] }
const keys = Array.from({ length: 120 }, (_, index) => `SPACE_${index}`)

function requestUrl(input: string | URL | Request): URL {
  return new URL(input instanceof Request ? input.url : String(input))
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    return requestUrl(input).pathname.endsWith('/attachments')
      ? Promise.resolve(Response.json({ results: [] }))
      : fetchMock(input, init)
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('Confluence bulk space validation', () => {
  it('bounds encoded URLs for long space keys', async () => {
    const longKeys = Array.from({ length: 20 }, (_, index) => `SPACE_${index}_${'x'.repeat(240)}`)
    const verifiedKeys: string[] = []
    fetchMock.mockImplementation(async (input) => {
      const url = requestUrl(input)
      expect(url.toString().length).toBeLessThan(2_100)
      const batch = url.searchParams.getAll('keys')
      verifiedKeys.push(...batch)
      return Response.json({ results: batch.map((key) => ({ key, id: key })) })
    })
    await expect(
      confluenceConnector.validateConfig(
        'token',
        { ...config, spaceKey: longKeys },
        { cloudId: 'cloud' }
      )
    ).resolves.toEqual({ valid: true })
    expect(verifiedKeys).toEqual(longKeys)
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1)
  })

  it('rejects an unavailable space in a later batch', async () => {
    fetchMock.mockImplementation(async (input) => {
      const batch = requestUrl(input).searchParams.getAll('keys')
      return Response.json({
        results: batch.filter((key) => key !== 'SPACE_110').map((key) => ({ key })),
      })
    })
    await expect(
      confluenceConnector.validateConfig(
        'token',
        { ...config, spaceKey: keys },
        { cloudId: 'cloud' }
      )
    ).resolves.toEqual({ valid: false, error: 'Space not found: SPACE_110' })
  })

  it('rejects repeated pagination instead of accepting a partial space set', async () => {
    fetchMock.mockImplementation(async () =>
      Response.json({
        results: [],
        _links: { next: '/wiki/api/v2/spaces?cursor=repeated' },
      })
    )
    await expect(
      confluenceConnector.validateConfig(
        'token',
        { ...config, spaceKey: keys },
        { cloudId: 'cloud' }
      )
    ).resolves.toEqual({
      valid: false,
      error: 'Confluence returned an incomplete space list. Try again.',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('Confluence bulk space listing', () => {
  const sourceConfig = { ...config, spaceKey: keys.slice(0, 52) }

  function page(id: string, next?: string): Response {
    return Response.json({
      results: [{ id, title: id, type: 'page', status: 'current', space: { key: 'SPACE_0' } }],
      _links: next ? { next: `/wiki/rest/api/content/search?cursor=${next}` } : {},
    })
  }

  it('marks a limit reached before later batches as incomplete for deletion reconciliation', async () => {
    fetchMock.mockResolvedValueOnce(page('1'))
    const context: Record<string, unknown> = { cloudId: 'cloud' }
    const result = await confluenceConnector.listDocuments(
      'token',
      { ...sourceConfig, maxPages: '1' },
      undefined,
      context
    )
    expect(result.hasMore).toBe(false)
    expect(result.nextCursor).toBeUndefined()
    expect(context.listingCapped).toBe(true)
  })

  it('rejects an invalid batch continuation before requesting any content', async () => {
    await expect(
      confluenceConnector.listDocuments('token', sourceConfig, 'space-batches:{"batch":-1}', {
        cloudId: 'cloud',
      })
    ).rejects.toThrow('Invalid Confluence space continuation')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('bounds CQL requests for long space keys while retaining filters', async () => {
    const longKeys = Array.from({ length: 20 }, (_, index) => `SPACE_${index}_${'x'.repeat(240)}`)
    fetchMock.mockImplementation(async () => Response.json({ results: [] }))
    const context: Record<string, unknown> = { cloudId: 'cloud' }
    let cursor: string | undefined
    do {
      const result = await confluenceConnector.listDocuments(
        'token',
        { ...sourceConfig, spaceKey: longKeys, labelFilter: 'published', contentType: 'all' },
        cursor,
        context
      )
      cursor = result.nextCursor
    } while (cursor)
    const queries = fetchMock.mock.calls.map(([input]) => requestUrl(input))
    expect(queries.length).toBeGreaterThan(1)
    for (const url of queries) {
      expect(url.toString().length).toBeLessThan(2_300)
      expect(url.searchParams.get('cql')).toContain(
        'type in ("page","blogpost") AND label="published"'
      )
    }
    for (const key of longKeys) {
      expect(
        queries.filter((url) => url.searchParams.get('cql')?.includes(`"${key}"`))
      ).toHaveLength(1)
    }
  })
})
