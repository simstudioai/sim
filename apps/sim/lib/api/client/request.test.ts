/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { requestJson } from '@/lib/api/client/request'
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

  it('throws instead of silently corrupting an array-of-objects query param', async () => {
    mockFetchReturning({ ok: true })

    const badContract = defineRouteContract({
      method: 'GET',
      path: '/api/test',
      query: z.object({ items: z.array(z.object({ a: z.string() })) }),
      response: { mode: 'json', schema: z.object({ ok: z.boolean() }) },
    })

    await expect(requestJson(badContract, { query: { items: [{ a: 'x' }] } })).rejects.toThrow(
      /arrays of objects are not URL-safe/
    )
  })
})
