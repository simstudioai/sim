/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildExaSearchBody, executePiExaSearch } from '@/tools/exa/search-client'

describe('Exa search client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('preserves the existing request body semantics', () => {
    expect(
      buildExaSearchBody({
        apiKey: 'key',
        query: 'query',
        numResults: 3,
        highlights: true,
        includeDomains: 'example.com, docs.example.com',
      })
    ).toEqual({
      query: 'query',
      numResults: 3,
      includeDomains: ['example.com', 'docs.example.com'],
      contents: { highlights: true },
    })
  })

  it('returns only the bounded Pi projection', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            results: [
              {
                title: 'Result',
                url: 'https://example.com',
                publishedDate: '2026-01-01',
                highlights: ['Useful snippet'],
                text: 'must not be forwarded',
                summary: 'must not be forwarded',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
    )

    await expect(
      executePiExaSearch({ apiKey: 'exa-secret', query: 'query', numResults: 5 })
    ).resolves.toEqual({
      results: [
        {
          title: 'Result',
          url: 'https://example.com',
          publishedDate: '2026-01-01',
          snippet: 'Useful snippet',
        },
      ],
    })
    expect(fetch).toHaveBeenCalledWith(
      'https://api.exa.ai/search',
      expect.objectContaining({
        redirect: 'error',
        headers: expect.objectContaining({ 'x-api-key': 'exa-secret' }),
      })
    )
  })

  it('rejects oversized upstream responses before parsing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('x'.repeat(1024 * 1024 + 1), {
          status: 200,
          headers: { 'content-length': String(1024 * 1024 + 1) },
        })
      )
    )

    await expect(
      executePiExaSearch({ apiKey: 'key', query: 'query', numResults: 5 })
    ).rejects.toThrow(/limit|maximum|large/i)
  })
})
