/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { searchTool } from '@/tools/firecrawl/search'
import type { SearchParams } from '@/tools/firecrawl/types'

const jsonOk = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

const searchParams: SearchParams = { apiKey: 'test-key', query: 'sim' }

const resolveBody = (params: SearchParams): Record<string, unknown> =>
  searchTool.request.body!(params) as Record<string, unknown>

const dataOutputProperties = (): Record<string, any> =>
  (searchTool.outputs.data as { properties: Record<string, any> }).properties

describe('firecrawl search response shape', () => {
  it('keeps the source-keyed envelope Firecrawl returns', async () => {
    const response = await searchTool.transformResponse!(
      jsonOk({
        success: true,
        data: {
          web: [{ title: 'w', description: 'd', url: 'https://web' }],
          news: [{ title: 'n', snippet: 's', url: 'https://news', position: 1 }],
          images: [{ title: 'i', imageUrl: 'https://img.png', url: 'https://page', position: 1 }],
        },
        creditsUsed: 3,
        id: 'job-1',
        warning: 'partial',
      }),
      searchParams
    )

    expect(response.output.data.web?.[0]?.url).toBe('https://web')
    expect(response.output.data.news?.[0]?.snippet).toBe('s')
    expect(response.output.data.images?.[0]?.imageUrl).toBe('https://img.png')
    expect(response.output.creditsUsed).toBe(3)
    expect(response.output.id).toBe('job-1')
    expect(response.output.warning).toBe('partial')
  })

  it('leaves unrequested source arrays absent rather than inventing empties', async () => {
    const response = await searchTool.transformResponse!(
      jsonOk({ success: true, data: { web: [] }, creditsUsed: 1 }),
      searchParams
    )

    expect(response.output.data.web).toEqual([])
    expect(response.output.data.news).toBeUndefined()
    expect(response.output.data.images).toBeUndefined()
  })

  it('yields an empty envelope when the payload carries no data object', async () => {
    const response = await searchTool.transformResponse!(jsonOk({ success: true }), searchParams)

    expect(response.output.data).toEqual({})
  })
})

describe('firecrawl search declared outputs', () => {
  it('declares data as a source-keyed object, not a flat array', () => {
    expect(searchTool.outputs.data.type).toBe('object')
    expect(Object.keys(dataOutputProperties()).sort()).toEqual(['images', 'news', 'web'])
  })

  it('makes every source array optional, since which appear depends on sources', () => {
    for (const source of ['web', 'news', 'images']) {
      expect(dataOutputProperties()[source].optional, `${source} must be optional`).toBe(true)
      expect(dataOutputProperties()[source].type).toBe('array')
    }
  })

  it('declares news items with snippet, the field news actually carries', () => {
    const news = dataOutputProperties().news.items.properties
    expect(news.snippet).toBeDefined()
    expect(news.description).toBeUndefined()
    expect(news.date).toBeDefined()
  })

  it('declares imageUrl on image items and does not claim they carry metadata', () => {
    const images = dataOutputProperties().images.items.properties
    expect(images.imageUrl).toBeDefined()
    expect(images.imageWidth).toBeDefined()
    expect(images.metadata).toBeUndefined()
    expect(images.markdown).toBeUndefined()
  })

  it('declares web items with description and optional scraped metadata', () => {
    const web = dataOutputProperties().web.items.properties
    expect(web.description).toBeDefined()
    expect(web.snippet).toBeUndefined()
    expect(web.metadata.optional).toBe(true)
  })

  it('declares the envelope fields the endpoint actually returns', () => {
    expect(searchTool.outputs.creditsUsed).toBeDefined()
    expect(searchTool.outputs.warning).toBeDefined()
    expect(searchTool.outputs.id).toBeDefined()
  })
})

describe('firecrawl search request params', () => {
  it('declares every param the request body reads', () => {
    const bodyReads = [
      'query',
      'limit',
      'sources',
      'categories',
      'tbs',
      'location',
      'country',
      'timeout',
      'ignoreInvalidURLs',
      'scrapeOptions',
    ]

    for (const paramId of bodyReads) {
      expect(searchTool.params[paramId], `missing declared param "${paramId}"`).toBeDefined()
    }
  })

  it('documents limit as per-source, since it is not a total across sources', () => {
    expect(searchTool.params.limit.description).toMatch(/per source/i)
  })

  it('does not promise that results are flattened into one array', () => {
    expect(searchTool.params.sources.description).not.toMatch(/flatten/i)
  })

  it('sends the declared optional params on the wire', () => {
    const body = resolveBody({
      apiKey: 'test-key',
      query: 'sim',
      limit: 5,
      sources: ['web', 'news'],
      categories: ['github'],
      tbs: 'qdr:d',
      location: 'Germany',
      country: 'DE',
      timeout: 30000,
      ignoreInvalidURLs: true,
    })

    expect(body).toMatchObject({
      query: 'sim',
      limit: 5,
      sources: ['web', 'news'],
      categories: ['github'],
      tbs: 'qdr:d',
      location: 'Germany',
      country: 'DE',
      timeout: 30000,
      ignoreInvalidURLs: true,
    })
  })
})

describe('firecrawl block search wiring', () => {
  it('exposes ignoreInvalidURLs on search, which also accepts it', async () => {
    const { FirecrawlBlock } = await import('@/blocks/blocks/firecrawl')
    const subBlock = FirecrawlBlock.subBlocks.find((block) => block.id === 'ignoreInvalidURLs')

    expect(subBlock?.condition).toMatchObject({ field: 'operation' })
    expect((subBlock?.condition as { value: string[] }).value).toContain('search')
  })

  it('maps ignoreInvalidURLs into the search request params', async () => {
    const { FirecrawlBlock } = await import('@/blocks/blocks/firecrawl')
    const params = FirecrawlBlock.tools.config!.params!({
      operation: 'search',
      apiKey: 'k',
      query: 'sim',
      ignoreInvalidURLs: true,
    })

    expect(params.ignoreInvalidURLs).toBe(true)
  })
})
