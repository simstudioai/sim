/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import {
  parseSearchSuggestionResponse,
  SearchSuggestionService,
} from '@/main/browser-search/suggestions'

describe('parseSearchSuggestionResponse', () => {
  it('keeps unique non-empty completions and omits the exact query row', () => {
    expect(
      parseSearchSuggestionResponse(
        [
          'what is the be',
          [
            'what is the be',
            'what is the best sleeping position',
            ' WHAT IS THE BEST SLEEPING POSITION ',
            '',
            42,
            'what is the benefit of creatine',
          ],
        ],
        'what is the be'
      )
    ).toEqual(['what is the best sleeping position', 'what is the benefit of creatine'])
  })

  it('rejects malformed provider payloads', () => {
    expect(parseSearchSuggestionResponse(null, 'sim')).toEqual([])
    expect(parseSearchSuggestionResponse(['sim', {}], 'sim')).toEqual([])
  })
})

describe('SearchSuggestionService', () => {
  it('uses only the fixed provider URL and caches repeated queries', async () => {
    const fetcher = vi.fn(
      async (_url: string, _init: RequestInit): Promise<Response> =>
        Response.json(['sim studio', ['sim studio ai', 'sim studio workflow']])
    )
    const service = new SearchSuggestionService(fetcher, () => 1_000)

    await expect(service.suggest(' sim studio ')).resolves.toEqual([
      'sim studio ai',
      'sim studio workflow',
    ])
    await expect(service.suggest('SIM STUDIO')).resolves.toEqual([
      'sim studio ai',
      'sim studio workflow',
    ])

    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = fetcher.mock.calls[0]
    expect(new URL(url).origin).toBe('https://suggestqueries.google.com')
    expect(new URL(url).searchParams.get('q')).toBe('sim studio')
    expect(init).toMatchObject({ method: 'GET', redirect: 'error' })
  })

  it('fails silently for short, oversized, rejected, and unsuccessful requests', async () => {
    const fetcher = vi.fn(
      async (_url: string, _init: RequestInit): Promise<Response> =>
        new Response(null, { status: 503 })
    )
    const service = new SearchSuggestionService(fetcher)

    await expect(service.suggest('s')).resolves.toEqual([])
    await expect(service.suggest('x'.repeat(201))).resolves.toEqual([])
    await expect(service.suggest('search me')).resolves.toEqual([])

    fetcher.mockRejectedValueOnce(new Error('offline'))
    await expect(service.suggest('another search')).resolves.toEqual([])
  })
})
