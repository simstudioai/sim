/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { resolveCrwBaseUrl } from '@/tools/crw/base-url'
import { crawlTool } from '@/tools/crw/crawl'
import { mapTool } from '@/tools/crw/map'
import { scrapeTool } from '@/tools/crw/scrape'
import { searchTool } from '@/tools/crw/search'

const respond = (body: unknown) => new Response(JSON.stringify(body))

describe('crw base-url', () => {
  it('defaults to the managed cloud base URL', () => {
    expect(resolveCrwBaseUrl()).toBe('https://fastcrw.com/api')
    expect(resolveCrwBaseUrl('')).toBe('https://fastcrw.com/api')
  })

  it('honors a self-hosted override and strips trailing slashes', () => {
    expect(resolveCrwBaseUrl('http://localhost:3000')).toBe('http://localhost:3000')
    expect(resolveCrwBaseUrl('http://localhost:3000/')).toBe('http://localhost:3000')
  })
})

describe('crw scrape', () => {
  const buildUrl = scrapeTool.request.url as (p: Record<string, unknown>) => string
  const buildBody = scrapeTool.request.body as (
    p: Record<string, unknown>
  ) => Record<string, unknown>
  const transform = scrapeTool.transformResponse!

  it('targets the default scrape endpoint and overrides for self-host', () => {
    expect(buildUrl({ apiKey: 'k', url: 'https://example.com' })).toBe(
      'https://fastcrw.com/api/v1/scrape'
    )
    expect(buildUrl({ apiKey: 'k', url: 'https://example.com', baseUrl: 'http://localhost:3000' })).toBe(
      'http://localhost:3000/v1/scrape'
    )
  })

  it('defaults formats to markdown and forwards optional params', () => {
    const body = buildBody({
      apiKey: 'k',
      url: 'https://example.com',
      onlyMainContent: true,
      waitFor: 500,
    })
    expect(body).toMatchObject({
      url: 'https://example.com',
      formats: ['markdown'],
      onlyMainContent: true,
      waitFor: 500,
    })
  })

  it('maps the documented scrape response (data envelope)', async () => {
    const result = await transform(
      respond({
        success: true,
        data: {
          markdown: '# Hello',
          html: '<h1>Hello</h1>',
          metadata: { title: 'Hello', sourceURL: 'https://example.com', statusCode: 200 },
        },
      })
    )

    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({
      markdown: '# Hello',
      html: '<h1>Hello</h1>',
      metadata: { title: 'Hello', sourceURL: 'https://example.com', statusCode: 200 },
    })
  })

  it('reports failure when the API body indicates an error', async () => {
    const result = await transform(respond({ success: false, error: 'invalid url' }))
    expect(result.success).toBe(false)
    expect(result.error).toBe('invalid url')
  })
})

describe('crw search', () => {
  const buildUrl = searchTool.request.url as (p: Record<string, unknown>) => string
  const buildBody = searchTool.request.body as (
    p: Record<string, unknown>
  ) => Record<string, unknown>
  const transform = searchTool.transformResponse!

  it('targets the search endpoint', () => {
    expect(buildUrl({ apiKey: 'k', query: 'sim' })).toBe('https://fastcrw.com/api/v1/search')
  })

  it('coerces limit and forwards sources', () => {
    const body = buildBody({ apiKey: 'k', query: 'sim', limit: 5, sources: ['web'] })
    expect(body).toEqual({ query: 'sim', limit: 5, sources: ['web'] })
  })

  it('maps the documented search response', async () => {
    const result = await transform(
      respond({
        success: true,
        data: [{ title: 'Sim', url: 'https://sim.ai', description: 'AI workspace' }],
      })
    )
    expect(result.output.data).toEqual([
      { title: 'Sim', url: 'https://sim.ai', description: 'AI workspace' },
    ])
  })

  it('reports failure when the API body indicates an error', async () => {
    const result = await transform(respond({ success: false, error: 'search unavailable' }))
    expect(result.success).toBe(false)
    expect(result.error).toBe('search unavailable')
  })
})

describe('crw map', () => {
  const buildUrl = mapTool.request.url as (p: Record<string, unknown>) => string
  const transform = mapTool.transformResponse!

  it('targets the map endpoint', () => {
    expect(buildUrl({ apiKey: 'k', url: 'https://example.com' })).toBe(
      'https://fastcrw.com/api/v1/map'
    )
  })

  it('maps the documented map response', async () => {
    const result = await transform(
      respond({ success: true, links: ['https://example.com', 'https://example.com/about'] })
    )
    expect(result.success).toBe(true)
    expect(result.output.links).toEqual(['https://example.com', 'https://example.com/about'])
  })

  it('returns an empty links array when none are present', async () => {
    const result = await transform(respond({ success: true }))
    expect(result.output.links).toEqual([])
  })
})

describe('crw crawl', () => {
  const buildUrl = crawlTool.request.url as (p: Record<string, unknown>) => string
  const buildBody = crawlTool.request.body as (
    p: Record<string, unknown>
  ) => Record<string, unknown>
  const transform = crawlTool.transformResponse!

  it('targets the crawl endpoint', () => {
    expect(buildUrl({ apiKey: 'k', url: 'https://example.com' })).toBe(
      'https://fastcrw.com/api/v1/crawl'
    )
  })

  it('defaults maxPages and builds scrapeOptions', () => {
    const body = buildBody({ apiKey: 'k', url: 'https://example.com', formats: ['markdown'] })
    expect(body).toMatchObject({
      url: 'https://example.com',
      maxPages: 100,
      scrapeOptions: { formats: ['markdown'], onlyMainContent: false },
    })
  })

  it('returns the job id from the async create response', async () => {
    const result = await transform(respond({ success: true, id: 'job-123' }))
    expect(result.success).toBe(true)
    expect(result.output.jobId).toBe('job-123')
    expect(result.output.pages).toEqual([])
    expect(result.output.total).toBe(0)
  })

  it('fails fast when job creation reports an error instead of polling', async () => {
    const result = await transform(respond({ success: false, error: 'quota exceeded' }))
    expect(result.success).toBe(false)
    expect(result.error).toBe('quota exceeded')
    expect(result.output.jobId).toBeUndefined()
  })
})
