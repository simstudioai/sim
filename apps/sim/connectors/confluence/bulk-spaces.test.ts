/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  beginListingCheckpoint,
  type ListingCheckpoint,
  listingFingerprint,
  runResumableListing,
} from '@/lib/knowledge/connectors/listing-checkpoint'
import { confluenceConnector } from '@/connectors/confluence/confluence'
import type { ExternalDocument } from '@/connectors/types'

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

  it.each([
    'legacy-provider-cursor',
    'space-batches:{',
    'space-batches:null',
    'space-batches:{}',
    'space-batches:{"batch":-1}',
    'space-batches:{"batch":2}',
    'space-batches:{"batch":0.5}',
    'space-batches:{"batch":0,"cursor":null}',
  ])('identifies an incompatible continuation for safe restart: %s', async (cursor) => {
    const error = await confluenceConnector
      .listDocuments('token', sourceConfig, cursor, { cloudId: 'cloud' })
      .catch((error: unknown) => error)
    expect(error).toBeInstanceOf(Error)
    expect(confluenceConnector.isListingCursorInvalidError?.(error)).toBe(true)
    expect(confluenceConnector.isCredentialInvalidError?.(error)).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('restarts a pre-batching checkpoint and exhausts every batch in a new generation', async () => {
    const checkpoint = {
      ...beginListingCheckpoint({
        fingerprint: listingFingerprint(sourceConfig),
        generationId: 'before-deployment',
        startedAt: new Date('2026-09-10T00:00:00Z'),
      }),
      cursor: 'legacy-provider-cursor',
      listedCount: 25_000,
      unsafe: true,
      contentFailures: true,
    }
    const saveCheckpoint = vi.fn(async (_checkpoint: ListingCheckpoint) => undefined)
    const processPage = vi.fn(
      async (_documents: ExternalDocument[], _checkpoint: ListingCheckpoint) => undefined
    )
    const restartedAt = new Date('2026-09-11T00:00:00Z')
    fetchMock
      .mockResolvedValueOnce(page('1', 'provider-page-2'))
      .mockResolvedValueOnce(page('2'))
      .mockResolvedValueOnce(page('3'))

    const result = await runResumableListing({
      connectorConfig: confluenceConnector,
      sourceConfig,
      syncContext: { cloudId: 'cloud' },
      checkpoint,
      deadlineAt: Date.now() + 60_000,
      beforePage: async () => undefined,
      getAccessToken: async () => 'token',
      getGenerationStartedAt: async () => restartedAt,
      processPage,
      saveCheckpoint,
    })

    expect(result).toMatchObject({
      complete: true,
      cursor: null,
      listedCount: 3,
      unsafe: false,
      contentFailures: false,
      startedAt: restartedAt.toISOString(),
    })
    expect(result.generationId).not.toBe(checkpoint.generationId)
    expect(saveCheckpoint).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        generationId: result.generationId,
        cursor: null,
        listedCount: 0,
        complete: false,
      })
    )
    expect(processPage.mock.calls.flatMap(([docs]) => docs.map((doc) => doc.externalId))).toEqual([
      '1',
      '2',
      '3',
    ])
    for (const [, cycle] of processPage.mock.calls) {
      expect(cycle.generationId).toBe(result.generationId)
    }
    const requests = fetchMock.mock.calls.map(([input]) => requestUrl(input))
    expect(requests.map((url) => url.searchParams.get('cursor'))).toEqual([
      null,
      'provider-page-2',
      null,
    ])
    expect(requests[0].searchParams.get('cql')).toBe(requests[1].searchParams.get('cql'))
    expect(requests[2].searchParams.get('cql')).toContain('space in ("SPACE_50","SPACE_51")')
  })

  it('preserves a provider continuation when the selected spaces still fit in one batch', async () => {
    fetchMock.mockResolvedValueOnce(page('1'))
    await confluenceConnector.listDocuments(
      'token',
      { ...sourceConfig, spaceKey: keys.slice(0, 2) },
      'valid-provider-cursor',
      { cloudId: 'cloud' }
    )
    expect(requestUrl(fetchMock.mock.calls[0][0]).searchParams.get('cursor')).toBe(
      'valid-provider-cursor'
    )
  })

  it('does not classify unrelated provider errors as restartable continuations', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 403 }))
    const error = await confluenceConnector
      .listDocuments('token', sourceConfig, undefined, {
        cloudId: 'cloud',
      })
      .catch((error: unknown) => error)
    expect(error).toEqual(new Error('Failed to search Confluence via CQL: 403'))
    expect(confluenceConnector.isListingCursorInvalidError?.(error)).toBe(false)
    expect(
      confluenceConnector.isListingCursorInvalidError?.(
        new Error('Invalid Confluence space continuation. Restart the sync.')
      )
    ).toBe(false)
    expect(confluenceConnector.isListingCursorInvalidError?.({ status: 401 })).toBe(false)
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
