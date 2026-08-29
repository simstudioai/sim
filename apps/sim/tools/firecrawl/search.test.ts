/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { mapTool } from '@/tools/firecrawl/map'
import { searchTool } from '@/tools/firecrawl/search'

/**
 * Builds a `Response` carrying a Firecrawl v2 JSON envelope.
 * @see https://docs.firecrawl.dev/api-reference/v2-openapi.json
 */
function firecrawlResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('firecrawl_search transformResponse', () => {
  /**
   * Payload shape taken from the `POST /v2/search` 200 schema: `data` is an object keyed by
   * source, not an array. News items carry `snippet` (not `description`); image items put the
   * containing page in `url` and the image itself in `imageUrl`.
   */
  it('keeps the source-keyed data envelope /v2/search returns', async () => {
    const response = firecrawlResponse({
      success: true,
      data: {
        web: [
          {
            title: 'Firecrawl',
            description: 'Turn websites into LLM-ready data',
            url: 'https://firecrawl.dev',
            position: 1,
          },
        ],
        news: [
          {
            title: 'Firecrawl raises a round',
            snippet: 'The crawler company announced funding',
            url: 'https://news.example.com/firecrawl',
            date: '2 days ago',
            imageUrl: 'https://news.example.com/thumb.png',
            position: 1,
          },
        ],
        images: [
          {
            title: 'Firecrawl logo',
            imageUrl: 'https://cdn.example.com/logo.png',
            imageWidth: 512,
            imageHeight: 512,
            url: 'https://example.com/about',
            position: 1,
          },
        ],
      },
      creditsUsed: 3,
    })

    const result = await searchTool.transformResponse!(response, {} as never)

    expect(result.success).toBe(true)
    expect(Array.isArray(result.output.data)).toBe(false)
    expect(result.output.data.web?.[0].url).toBe('https://firecrawl.dev')
    expect(result.output.data.news?.[0].snippet).toBe('The crawler company announced funding')
    expect(result.output.data.news?.[0]).not.toHaveProperty('description')
    expect(result.output.data.images?.[0].imageUrl).toBe('https://cdn.example.com/logo.png')
    expect(result.output.data.images?.[0].url).toBe('https://example.com/about')
    expect(result.output.creditsUsed).toBe(3)
  })

  it('yields an empty envelope rather than undefined when no sources came back', async () => {
    const result = await searchTool.transformResponse!(
      firecrawlResponse({ success: true }),
      {} as never
    )

    expect(result.output.data).toEqual({})
  })
})

describe('firecrawl_search declared outputs', () => {
  it('declares data as the source-keyed object, not an array', () => {
    expect(searchTool.outputs?.data.type).toBe('object')
    expect(Object.keys(searchTool.outputs?.data.properties ?? {})).toEqual([
      'web',
      'news',
      'images',
    ])
  })

  it('declares snippet on news items and never description', () => {
    const news = searchTool.outputs?.data.properties?.news
    expect(news?.items?.properties).toHaveProperty('snippet')
    expect(news?.items?.properties).not.toHaveProperty('description')
  })
})

describe('firecrawl_map', () => {
  /**
   * `request-transport.ts` reads `params.timeout` as the outbound fetch deadline for every tool,
   * so a tool param of that name silently doubles as the local abort. The Firecrawl-side map
   * timeout has to travel under a different param name.
   */
  it('does not declare a param named timeout', () => {
    expect(mapTool.params).not.toHaveProperty('timeout')
    expect(mapTool.params).toHaveProperty('mapTimeout')
  })

  it('sends mapTimeout to Firecrawl as the body-level timeout', () => {
    const body = (mapTool.request.body as (params: never) => Record<string, unknown>)({
      url: 'https://example.com',
      mapTimeout: 15000,
    } as never)

    expect(body.timeout).toBe(15000)
    expect(body).not.toHaveProperty('mapTimeout')
  })

  /**
   * `/v2/map` returns `links` as `SearchResultWeb[]` — objects with a required `url` plus an
   * optional `title` and `description` — not bare URL strings.
   * @see https://docs.firecrawl.dev/api-reference/v2-openapi.json (MapResponse)
   */
  it('keeps the link objects /v2/map returns', async () => {
    const response = firecrawlResponse({
      success: true,
      links: [
        {
          url: 'https://example.com/blog',
          title: 'Blog',
          description: 'Company blog',
        },
        { url: 'https://example.com/pricing' },
      ],
    })

    const result = await mapTool.transformResponse!(response, {} as never)

    expect(result.output.links).toEqual([
      { url: 'https://example.com/blog', title: 'Blog', description: 'Company blog' },
      { url: 'https://example.com/pricing' },
    ])
  })

  it('declares links as objects carrying url, title and description', () => {
    expect(mapTool.outputs?.links.items?.type).toBe('object')
    expect(Object.keys(mapTool.outputs?.links.items?.properties ?? {})).toEqual([
      'url',
      'title',
      'description',
    ])
  })
})

describe('firecrawl_search sources', () => {
  /**
   * `data.news` and `data.images` only ever appear when the request asks for them, so the
   * documented verticals need a reachable `sources` input.
   * @see https://docs.firecrawl.dev/api-reference/v2-openapi.json
   */
  it('exposes sources so the documented news and images verticals are reachable', () => {
    expect(searchTool.params.sources?.visibility).toBe('user-or-llm')
  })

  it('forwards the requested sources to Firecrawl', () => {
    const body = (searchTool.request.body as (params: never) => Record<string, unknown>)({
      query: 'firecrawl',
      sources: ['web', 'news'],
    } as never)

    expect(body.sources).toEqual(['web', 'news'])
  })

  it('omits sources entirely when none were chosen, letting Firecrawl default to web', () => {
    const body = (searchTool.request.body as (params: never) => Record<string, unknown>)({
      query: 'firecrawl',
    } as never)

    expect(body).not.toHaveProperty('sources')
  })
})

describe('firecrawl_map edge cases', () => {
  it('sends an explicit mapTimeout of 0 instead of falling back to the provider default', () => {
    const body = (mapTool.request.body as (params: never) => Record<string, unknown>)({
      url: 'https://example.com',
      mapTimeout: 0,
    } as never)

    expect(body.timeout).toBe(0)
  })

  it('omits the timeout for a blank mapTimeout', () => {
    const body = (mapTool.request.body as (params: never) => Record<string, unknown>)({
      url: 'https://example.com',
      mapTimeout: '',
    } as never)

    expect(body).not.toHaveProperty('timeout')
  })

  it('widens a bare URL string link into the declared object shape', async () => {
    const response = new Response(
      JSON.stringify({ success: true, links: ['https://example.com/a', { url: 'https://b.com' }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

    const result = await mapTool.transformResponse!(response, {} as never)

    expect(result.output.links).toEqual([
      { url: 'https://example.com/a' },
      { url: 'https://b.com' },
    ])
  })
})

describe('firecrawl_search declared nullability', () => {
  it('marks scraped content nullable and metadata optional on web and news items', () => {
    for (const source of ['web', 'news'] as const) {
      const item = searchTool.outputs?.data.properties?.[source].items?.properties
      expect(item?.metadata.optional).toBe(true)
      for (const field of ['markdown', 'html', 'rawHtml', 'screenshot']) {
        expect(item?.[field].nullable).toBe(true)
      }
    }
  })
})
