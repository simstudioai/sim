/**
 * @vitest-environment node
 */
import { inputValidationMock } from '@sim/testing'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

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
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

describe('Confluence bulk space validation', () => {
  it('validates every selected space with bounded query sizes and follows partial pages', async () => {
    const verifiedKeys: string[] = []
    fetchMock.mockImplementation(async (input) => {
      const url = requestUrl(input)
      const batch = url.searchParams.getAll('keys')
      expect(batch.length).toBeLessThanOrEqual(50)
      expect(Number(url.searchParams.get('limit'))).toBeLessThanOrEqual(50)
      const page = url.searchParams.has('cursor') ? batch.slice(25) : batch.slice(0, 25)
      verifiedKeys.push(...page)
      return Response.json({
        results: page.map((key) => ({ key, id: key })),
        _links:
          batch.length > 25 && !url.searchParams.has('cursor')
            ? { next: '/wiki/api/v2/spaces?cursor=second-page' }
            : {},
      })
    })

    await expect(
      confluenceConnector.validateConfig(
        'token',
        { ...config, spaceKey: [...keys, keys[0]] },
        { cloudId: 'cloud' }
      )
    ).resolves.toEqual({ valid: true })
    expect(verifiedKeys).toEqual(keys)
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

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

  it('does not accept a later failed batch', async () => {
    fetchMock.mockImplementation(async (input) => {
      const batch = requestUrl(input).searchParams.getAll('keys')
      return batch.includes('SPACE_50')
        ? Response.json({}, { status: 403 })
        : Response.json({ results: batch.map((key) => ({ key })) })
    })
    await expect(
      confluenceConnector.validateConfig(
        'token',
        { ...config, spaceKey: keys },
        { cloudId: 'cloud' }
      )
    ).resolves.toEqual({ valid: false, error: 'Failed to validate spaces: 403' })
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

  it('exhausts each provider cursor before moving to the next explicit space batch', async () => {
    fetchMock
      .mockResolvedValueOnce(page('1', 'provider-page-2'))
      .mockResolvedValueOnce(page('2'))
      .mockResolvedValueOnce(page('3'))
    const context: Record<string, unknown> = { cloudId: 'cloud' }
    const first = await confluenceConnector.listDocuments('token', sourceConfig, undefined, context)
    const second = await confluenceConnector.listDocuments(
      'token',
      sourceConfig,
      first.nextCursor,
      context
    )
    const third = await confluenceConnector.listDocuments(
      'token',
      sourceConfig,
      second.nextCursor,
      context
    )
    expect(
      [first, second, third].flatMap((result) => result.documents.map((doc) => doc.externalId))
    ).toEqual(['1', '2', '3'])
    expect([first.hasMore, second.hasMore, third.hasMore]).toEqual([true, true, false])
    const requests = fetchMock.mock.calls.map(([input]) => requestUrl(input))
    expect(requests[0].searchParams.get('cql')).toBe(requests[1].searchParams.get('cql'))
    expect(requests[1].searchParams.get('cursor')).toBe('provider-page-2')
    expect(requests[2].searchParams.has('cursor')).toBe(false)
    expect(requests[2].searchParams.get('cql')).toContain('space in ("SPACE_50","SPACE_51")')
    expect(context.listingCapped).toBeUndefined()
  })

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

  it('continues through an empty batch without widening the query', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ results: [] })).mockResolvedValueOnce(page('1'))
    const context: Record<string, unknown> = { cloudId: 'cloud' }
    const first = await confluenceConnector.listDocuments('token', sourceConfig, undefined, context)
    const last = await confluenceConnector.listDocuments(
      'token',
      sourceConfig,
      first.nextCursor,
      context
    )
    expect(first.documents).toEqual([])
    expect(first.hasMore).toBe(true)
    expect(last.documents.map((doc) => doc.externalId)).toEqual(['1'])
    expect(last.hasMore).toBe(false)
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
