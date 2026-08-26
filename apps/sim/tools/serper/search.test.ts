/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { searchTool } from '@/tools/serper/search'

/**
 * `transformResponse` selects its result branch from the last path segment of `response.url`, which
 * `new Response()` leaves empty — hence the override.
 */
function serperResponse(url: string, body: unknown): Response {
  const response = new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
  Object.defineProperty(response, 'url', { value: url })
  return response
}

describe('serper searchTool.transformResponse', () => {
  it('keeps the publication date Google reports on organic web results', async () => {
    const response = serperResponse('https://google.serper.dev/search', {
      organic: [
        {
          title: 'Release notes',
          link: 'https://example.com/notes',
          snippet: 'What changed',
          date: '2 days ago',
        },
      ],
    })

    const result = await searchTool.transformResponse!(response, {} as never)

    expect(result.success).toBe(true)
    expect(result.output.searchResults).toEqual([
      {
        title: 'Release notes',
        link: 'https://example.com/notes',
        snippet: 'What changed',
        position: 1,
        date: '2 days ago',
      },
    ])
  })

  it('leaves the date undefined when the result has none', async () => {
    const response = serperResponse('https://google.serper.dev/search', {
      organic: [{ title: 'Docs', link: 'https://example.com/docs', snippet: 'Reference' }],
    })

    const result = await searchTool.transformResponse!(response, {} as never)

    expect(result.output.searchResults[0].date).toBeUndefined()
  })

  it('maps videos results instead of falling through to the organic branch', async () => {
    const response = serperResponse('https://google.serper.dev/videos', {
      videos: [
        {
          title: 'Build an agent in 10 minutes',
          link: 'https://youtube.com/watch?v=abc',
          snippet: 'A walkthrough',
          source: 'YouTube',
          duration: '10:30',
          date: '3 weeks ago',
        },
      ],
    })

    const result = await searchTool.transformResponse!(response, {} as never)

    expect(result.success).toBe(true)
    expect(result.output.searchResults).toHaveLength(1)
    expect(result.output.searchResults).toEqual([
      {
        title: 'Build an agent in 10 minutes',
        link: 'https://youtube.com/watch?v=abc',
        snippet: 'A walkthrough',
        position: 1,
        date: '3 weeks ago',
        source: 'YouTube',
        duration: '10:30',
      },
    ])
  })

  it('maps shopping results instead of falling through to the organic branch', async () => {
    const response = serperResponse('https://google.serper.dev/shopping', {
      shopping: [
        {
          title: 'Mechanical Keyboard',
          link: 'https://example.com/keyboard',
          snippet: '87-key hot-swappable',
          source: 'Example Store',
          price: '$19.99',
          imageUrl: 'https://example.com/keyboard.png',
        },
      ],
    })

    const result = await searchTool.transformResponse!(response, {} as never)

    expect(result.success).toBe(true)
    expect(result.output.searchResults).toHaveLength(1)
    expect(result.output.searchResults).toEqual([
      {
        title: 'Mechanical Keyboard',
        link: 'https://example.com/keyboard',
        snippet: '87-key hot-swappable',
        position: 1,
        source: 'Example Store',
        price: '$19.99',
        imageUrl: 'https://example.com/keyboard.png',
      },
    ])
  })

  it('maps news results unchanged', async () => {
    const response = serperResponse('https://google.serper.dev/news', {
      news: [
        {
          title: 'Markets rally',
          link: 'https://example.com/markets',
          snippet: 'Stocks climbed',
          date: '2 hours ago',
          imageUrl: 'https://example.com/markets.png',
          source: 'Example Wire',
        },
      ],
    })

    const result = await searchTool.transformResponse!(response, {} as never)

    expect(result.output.searchResults).toEqual([
      {
        title: 'Markets rally',
        link: 'https://example.com/markets',
        snippet: 'Stocks climbed',
        position: 1,
        date: '2 hours ago',
        imageUrl: 'https://example.com/markets.png',
      },
    ])
  })

  it('maps places results unchanged', async () => {
    const response = serperResponse('https://google.serper.dev/places', {
      places: [
        {
          title: 'Corner Coffee',
          link: 'https://example.com/coffee',
          snippet: 'Espresso bar',
          rating: 4.6,
          address: '1 Main St',
          ratingCount: 812,
        },
      ],
    })

    const result = await searchTool.transformResponse!(response, {} as never)

    expect(result.output.searchResults).toEqual([
      {
        title: 'Corner Coffee',
        link: 'https://example.com/coffee',
        snippet: 'Espresso bar',
        position: 1,
        rating: 4.6,
        address: '1 Main St',
      },
    ])
  })

  it('maps images results unchanged', async () => {
    const response = serperResponse('https://google.serper.dev/images', {
      images: [
        {
          title: 'Sunset',
          link: 'https://example.com/sunset',
          snippet: 'Golden hour',
          imageUrl: 'https://example.com/sunset.png',
        },
      ],
    })

    const result = await searchTool.transformResponse!(response, {} as never)

    expect(result.output.searchResults).toEqual([
      {
        title: 'Sunset',
        link: 'https://example.com/sunset',
        snippet: 'Golden hour',
        position: 1,
        imageUrl: 'https://example.com/sunset.png',
      },
    ])
  })

  it('numbers every item in a multi-result vertical from 1', async () => {
    const response = serperResponse('https://google.serper.dev/videos', {
      videos: [
        { title: 'One', link: 'https://example.com/1' },
        { title: 'Two', link: 'https://example.com/2' },
      ],
    })

    const result = await searchTool.transformResponse!(response, {} as never)

    expect(result.output.searchResults.map((item) => item.position)).toEqual([1, 2])
  })

  it('rejects a user-supplied vertical the dispatch table cannot handle', async () => {
    const response = serperResponse('https://google.serper.dev/search', {
      organic: [{ title: 'Place', link: 'https://example.com/place' }],
    })

    await expect(
      searchTool.transformResponse!(response, { query: 'q', apiKey: 'k', type: 'maps' } as never)
    ).rejects.toThrow('Unsupported Serper search type "maps"')
  })

  it.each(['scholar', 'patents'])(
    'maps %s results through the organic key without a fabricated date',
    async (type) => {
      const response = serperResponse(`https://google.serper.dev/${type}`, {
        organic: [
          {
            title: 'A cited work',
            link: 'https://example.com/work',
            snippet: 'Abstract',
            year: 2019,
            citedBy: 42,
          },
        ],
      })

      const result = await searchTool.transformResponse!(response, {} as never)

      expect(result.success).toBe(true)
      expect(result.output.searchResults).toEqual([
        {
          title: 'A cited work',
          link: 'https://example.com/work',
          snippet: 'Abstract',
          position: 1,
        },
      ])
      expect(result.output.searchResults[0]).not.toHaveProperty('date')
    }
  )
})

describe('serper searchTool.transformResponse vertical dispatch', () => {
  const videosBody = {
    videos: [{ title: 'Clip', link: 'https://example.com/clip' }],
    organic: [{ title: 'Page', link: 'https://example.com/page' }],
  }

  it('dispatches on the validated params, not the server-controlled response URL', async () => {
    const response = serperResponse('https://google.serper.dev/search', videosBody)

    const result = await searchTool.transformResponse!(response, {
      query: 'q',
      apiKey: 'k',
      type: 'videos',
    })

    expect(result.output.searchResults).toEqual([
      { title: 'Clip', link: 'https://example.com/clip', position: 1 },
    ])
  })

  it('reads the requested vertical when response.url is empty', async () => {
    const response = new Response(JSON.stringify(videosBody), { status: 200 })
    expect(response.url).toBe('')

    const result = await searchTool.transformResponse!(response, {
      query: 'q',
      apiKey: 'k',
      type: 'videos',
    })

    expect(result.output.searchResults).toEqual([
      { title: 'Clip', link: 'https://example.com/clip', position: 1 },
    ])
  })

  it('ignores a query string appended to the response URL instead of throwing', async () => {
    const response = serperResponse('https://google.serper.dev/videos?utm=1', videosBody)

    const result = await searchTool.transformResponse!(response, {} as never)

    expect(result.output.searchResults).toEqual([
      { title: 'Clip', link: 'https://example.com/clip', position: 1 },
    ])
  })

  it('falls back to the search vertical when the response URL names an unknown vertical', async () => {
    const response = serperResponse('https://google.serper.dev/maps', videosBody)

    const result = await searchTool.transformResponse!(response, {} as never)

    expect(result.output.searchResults).toEqual([
      { title: 'Page', link: 'https://example.com/page', position: 1 },
    ])
  })

  it('falls back to the search vertical when neither params nor URL name one', async () => {
    const response = new Response(JSON.stringify(videosBody), { status: 200 })

    const result = await searchTool.transformResponse!(response, {} as never)

    expect(result.output.searchResults).toEqual([
      { title: 'Page', link: 'https://example.com/page', position: 1 },
    ])
  })
})

describe('serper searchTool.request.url', () => {
  function url(type?: string): string {
    const build = searchTool.request.url as (params: Record<string, unknown>) => string
    return build({ query: 'q', apiKey: 'k', type })
  }

  it('defaults to the search vertical', () => {
    expect(url()).toBe('https://google.serper.dev/search')
  })

  it.each(['search', 'news', 'places', 'images', 'videos', 'shopping', 'scholar', 'patents'])(
    'builds the %s vertical URL',
    (type) => {
      expect(url(type)).toBe(`https://google.serper.dev/${type}`)
    }
  )

  it('rejects a vertical the transform cannot handle', () => {
    expect(() => url('maps')).toThrow(
      'Unsupported Serper search type "maps". Supported types: search, news, places, images, videos, shopping, scholar, patents.'
    )
  })

  it('rejects a path-traversing type instead of interpolating it into the URL', () => {
    expect(() => url('../v1/admin')).toThrow('Unsupported Serper search type')
  })
})
