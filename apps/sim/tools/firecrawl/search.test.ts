/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { searchTool } from '@/tools/firecrawl/search'
import type { SearchParams } from '@/tools/firecrawl/types'
import { createUserToolSchema } from '@/tools/params'

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
      'firecrawlTimeout',
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
      firecrawlTimeout: 30000,
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

  it.each(['sources', 'categories', 'location', 'country'])(
    'exposes %s as a search subBlock, so it is not agent-path only',
    async (id) => {
      const { FirecrawlBlock } = await import('@/blocks/blocks/firecrawl')
      const subBlock = FirecrawlBlock.subBlocks.find((block) => block.id === id)

      expect(subBlock, `missing subBlock "${id}"`).toBeDefined()
      expect((subBlock?.condition as { value: string[] }).value).toContain('search')
    }
  )

  it('leaves tbs agent-only — its Google micro-syntax earns no raw text box', async () => {
    const { FirecrawlBlock } = await import('@/blocks/blocks/firecrawl')

    expect(FirecrawlBlock.subBlocks.find((block) => block.id === 'tbs')).toBeUndefined()
    expect(searchTool.params.tbs.visibility).toBe('user-or-llm')
  })

  it('maps the new search subBlocks into the search request params', async () => {
    const { FirecrawlBlock } = await import('@/blocks/blocks/firecrawl')
    const params = FirecrawlBlock.tools.config!.params!({
      operation: 'search',
      apiKey: 'k',
      query: 'sim',
      sources: ['web', 'news'],
      categories: ['github'],
      location: 'Germany',
      country: 'DE',
    })

    expect(params.sources).toEqual(['web', 'news'])
    expect(params.categories).toEqual(['github'])
    expect(params.location).toBe('Germany')
    expect(params.country).toBe('DE')
  })

  it('normalizes the comma-string form a multiSelect dropdown can persist', async () => {
    const { FirecrawlBlock } = await import('@/blocks/blocks/firecrawl')
    const params = FirecrawlBlock.tools.config!.params!({
      operation: 'search',
      apiKey: 'k',
      query: 'sim',
      sources: 'web,news',
      categories: '',
    })

    expect(params.sources).toEqual(['web', 'news'])
    expect(Object.hasOwn(params, 'categories')).toBe(false)
  })

  it('does not leak search-only fields onto another operation', async () => {
    const { FirecrawlBlock } = await import('@/blocks/blocks/firecrawl')
    const params = FirecrawlBlock.tools.config!.params!({
      operation: 'map',
      apiKey: 'k',
      url: 'https://example.com',
      sources: ['web'],
      country: 'DE',
    })

    expect(Object.hasOwn(params, 'sources')).toBe(false)
    expect(Object.hasOwn(params, 'country')).toBe(false)
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

describe('firecrawl search constrained enum params', () => {
  const constValues = (paramId: string): string[] =>
    (searchTool.params[paramId].items?.anyOf ?? []).map(
      (member: { const?: unknown }) => member.const as string
    )

  // The literal lists below come from https://docs.firecrawl.dev/features/search
  // (Search Sources and Search Categories), not from the implementation.
  it('constrains sources to the three literals the strict schema accepts', () => {
    expect(constValues('sources').sort()).toEqual(['images', 'news', 'web'])
  })

  it('constrains categories to the four literals the strict schema accepts', () => {
    expect(constValues('categories').sort()).toEqual(['developer', 'github', 'pdf', 'research'])
  })

  it('flows the const union into the model-visible tool schema', () => {
    const schema = createUserToolSchema(searchTool)
    const sources = schema.properties.sources as {
      items?: { anyOf?: Array<{ const?: unknown }> }
    }

    expect(sources.items?.anyOf?.map((member) => member.const).sort()).toEqual([
      'images',
      'news',
      'web',
    ])
  })
})

describe('firecrawl search country', () => {
  it("forwards the caller's country verbatim", () => {
    expect(resolveBody({ apiKey: 'k', query: 'sim', country: 'DE' }).country).toBe('DE')
  })

  it('omits country when unset, leaving Firecrawl to apply its own "US" default', () => {
    // https://docs.firecrawl.dev/api-reference/v2-endpoint/search documents
    // `country` with `default: US`, unconditionally. Sim must not pre-fill it,
    // or a future change to that default silently stops reaching callers.
    expect(Object.hasOwn(resolveBody({ apiKey: 'k', query: 'sim' }), 'country')).toBe(false)
  })
})

describe('firecrawl search timeout is not the transport deadline', () => {
  it('does not declare the transport-reserved `timeout` param', () => {
    expect(searchTool.params.timeout).toBeUndefined()
    expect(searchTool.params.firecrawlTimeout).toBeDefined()
  })

  it('maps firecrawlTimeout onto the request body as Firecrawl `timeout`', () => {
    expect(resolveBody({ apiKey: 'k', query: 'sim', firecrawlTimeout: 45000 }).timeout).toBe(45000)
  })
})

describe('firecrawl block timeout wiring', () => {
  it('keeps the subBlock id `timeout` so saved workflow state is not orphaned', async () => {
    const { FirecrawlBlock } = await import('@/blocks/blocks/firecrawl')
    const subBlock = FirecrawlBlock.subBlocks.find((block) => block.id === 'timeout')

    expect(subBlock).toBeDefined()
    expect((subBlock?.condition as { value: string[] }).value).toEqual([
      'scrape',
      'search',
      'parse',
    ])
  })

  it.each(['scrape', 'search'])(
    'remaps timeout off the transport for the external %s operation',
    async (operation) => {
      const { FirecrawlBlock } = await import('@/blocks/blocks/firecrawl')
      const params = FirecrawlBlock.tools.config!.params!({
        operation,
        apiKey: 'k',
        url: 'https://example.com',
        query: 'sim',
        timeout: '45000',
      })

      expect(params.firecrawlTimeout).toBe(45000)
      expect(Object.hasOwn(params, 'timeout')).toBe(true)
      expect(params.timeout).toBeUndefined()
    }
  )

  it.each(['map', 'crawl', 'extract', 'agent'])(
    'clears a stale timeout on %s, whose subBlock is hidden but whose saved value survives',
    async (operation) => {
      const { FirecrawlBlock } = await import('@/blocks/blocks/firecrawl')
      const params = FirecrawlBlock.tools.config!.params!({
        operation,
        apiKey: 'k',
        url: 'https://example.com',
        urls: ['https://example.com'],
        agentPrompt: 'go',
        prompt: 'go',
        timeout: '45000',
      })

      expect(Object.hasOwn(params, 'timeout')).toBe(true)
      expect(params.timeout).toBeUndefined()
    }
  )

  it('keeps timeout on the transport for parse, which posts to an internal route', async () => {
    const { FirecrawlBlock } = await import('@/blocks/blocks/firecrawl')
    const params = FirecrawlBlock.tools.config!.params!({
      operation: 'parse',
      apiKey: 'k',
      file: { name: 'a.pdf', url: 'https://x/a.pdf', size: 1, type: 'application/pdf', key: 'k' },
      timeout: '45000',
    })

    expect(params.timeout).toBe(45000)
    expect(params.firecrawlTimeout).toBeUndefined()
  })
})

describe('firecrawl search numeric coercion', () => {
  it('drops a non-numeric limit rather than putting JSON null on the wire', () => {
    const body = resolveBody({ apiKey: 'k', query: 'sim', limit: 'ten' as unknown as number })

    expect(Object.hasOwn(body, 'limit')).toBe(false)
  })

  it('drops a non-numeric firecrawlTimeout rather than putting JSON null on the wire', () => {
    const body = resolveBody({
      apiKey: 'k',
      query: 'sim',
      firecrawlTimeout: 'soon' as unknown as number,
    })

    expect(Object.hasOwn(body, 'timeout')).toBe(false)
  })

  it('still forwards numeric strings, which the block short-inputs produce', () => {
    const body = resolveBody({
      apiKey: 'k',
      query: 'sim',
      limit: '5' as unknown as number,
      firecrawlTimeout: '45000' as unknown as number,
    })

    expect(body).toMatchObject({ limit: 5, timeout: 45000 })
  })
})
