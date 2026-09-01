/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { requestJson } from '@/lib/api/client/request'
import { CLIENT_ID_HEADER } from '@/lib/api/client-id'
import { listKnowledgeDocumentsContract } from '@/lib/api/contracts/knowledge'
import { defineRouteContract } from '@/lib/api/contracts/types'

/**
 * Captures the URL of the last fetch call and returns a valid JSON response so
 * `requestJson`'s response validation passes.
 */
function mockFetchReturning(body: unknown) {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('requestJson query serialization', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('serializes a JSON-string query param verbatim (regression: tagFilters)', async () => {
    const fetchMock = mockFetchReturning({
      success: true,
      data: {
        documents: [],
        pagination: { total: 0, limit: 50, offset: 0, hasMore: false },
      },
    })

    const tagFilters = JSON.stringify([
      { tagSlot: 'tag1', fieldType: 'text', operator: 'contains', value: 'Ada Lovelace' },
    ])

    await requestJson(listKnowledgeDocumentsContract, {
      params: { id: 'kb-1' },
      query: { tagFilters },
    })

    const calledUrl = String(fetchMock.mock.calls[0][0])
    const url = new URL(calledUrl, 'https://example.test')
    // The param must round-trip as the exact JSON, never "[object Object]".
    expect(url.searchParams.get('tagFilters')).toBe(tagFilters)
    expect(calledUrl).not.toContain('object+Object')
    expect(calledUrl).not.toContain('[object Object]')
  })

  it('JSON-encodes an array-of-objects query param instead of corrupting or throwing', async () => {
    // A SortSpec ([{field, direction}]) is the everyday case: repeat-append
    // would send "[object Object]", so the whole array travels as ONE JSON
    // string param, mirroring plain objects; the server contract decodes it.
    const fetchMock = mockFetchReturning({ ok: true })

    const contract = defineRouteContract({
      method: 'GET',
      path: '/api/test',
      query: z.object({ items: z.array(z.object({ a: z.string() })) }),
      response: { mode: 'json', schema: z.object({ ok: z.boolean() }) },
    })

    await requestJson(contract, { query: { items: [{ a: 'x' }] } })
    const url = String(fetchMock.mock.calls[0][0])
    expect(decodeURIComponent(url)).toContain('items=[{"a":"x"}]')
  })

  it('keeps repeat-append for scalar arrays', async () => {
    const fetchMock = mockFetchReturning({ ok: true })

    const contract = defineRouteContract({
      method: 'GET',
      path: '/api/test',
      query: z.object({ tags: z.array(z.string()) }),
      response: { mode: 'json', schema: z.object({ ok: z.boolean() }) },
    })

    await requestJson(contract, { query: { tags: ['a', 'b'] } })
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('tags=a&tags=b')
  })
})

/**
 * The tab id rides on every request so a broadcast raised by one can be attributed back to the tab
 * that caused it. Asserted here rather than on the reader, because the header being *sent* is the
 * half that silently does nothing if it regresses.
 */
describe('requestJson client id header', () => {
  const contract = defineRouteContract({
    method: 'GET',
    path: '/api/test',
    response: { mode: 'json', schema: z.object({ ok: z.boolean() }) },
  })

  function sentHeaders(fetchMock: ReturnType<typeof mockFetchReturning>): Record<string, string> {
    return (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>
  }

  it('sends the tab id in the browser', async () => {
    vi.stubGlobal('window', {})
    const fetchMock = mockFetchReturning({ ok: true })

    await requestJson(contract, {})

    expect(sentHeaders(fetchMock)[CLIENT_ID_HEADER]).toEqual(expect.any(String))
  })

  it('omits it on the server, where there is no tab to name', async () => {
    vi.stubGlobal('window', undefined)
    const fetchMock = mockFetchReturning({ ok: true })

    await requestJson(contract, {})

    expect(sentHeaders(fetchMock)[CLIENT_ID_HEADER]).toBeUndefined()
  })
})
