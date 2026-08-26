/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { flattenFirecrawlSearchResults, searchTool } from '@/tools/firecrawl/search'
import type { SearchParams } from '@/tools/firecrawl/types'

const result = (url: string) => ({
  title: url,
  description: 'd',
  url,
  metadata: { sourceURL: url },
})

const jsonOk = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

const searchParams: SearchParams = { apiKey: 'test-key', query: 'sim' }

const resolveBody = (params: SearchParams): Record<string, unknown> =>
  searchTool.request.body!(params) as Record<string, unknown>

describe('firecrawl search result flattening', () => {
  it('flattens the default web-only envelope into the declared array', async () => {
    const response = await searchTool.transformResponse!(
      jsonOk({ data: { web: [result('https://a'), result('https://b')] }, creditsUsed: 2 }),
      searchParams
    )

    expect(Array.isArray(response.output.data)).toBe(true)
    expect(response.output.data.map((item) => item.url)).toEqual(['https://a', 'https://b'])
    expect(response.output.creditsUsed).toBe(2)
  })

  it('concatenates multiple sources in web, news, images order', () => {
    const flattened = flattenFirecrawlSearchResults({
      images: [result('https://image')],
      news: [result('https://news')],
      web: [result('https://web')],
    })

    expect(flattened.map((item) => item.url)).toEqual([
      'https://web',
      'https://news',
      'https://image',
    ])
  })

  it('appends unknown future source keys alphabetically after the known ones', () => {
    const flattened = flattenFirecrawlSearchResults({
      web: [result('https://web')],
      videos: [result('https://video')],
      podcasts: [result('https://podcast')],
    })

    expect(flattened.map((item) => item.url)).toEqual([
      'https://web',
      'https://podcast',
      'https://video',
    ])
  })

  it('passes a plain array through unchanged', () => {
    const flattened = flattenFirecrawlSearchResults([result('https://a')])
    expect(flattened.map((item) => item.url)).toEqual(['https://a'])
  })

  it('yields an empty array for a missing or non-object payload', () => {
    expect(flattenFirecrawlSearchResults(undefined)).toEqual([])
    expect(flattenFirecrawlSearchResults(null)).toEqual([])
    expect(flattenFirecrawlSearchResults('nope')).toEqual([])
    expect(flattenFirecrawlSearchResults({ web: 'not-an-array' })).toEqual([])
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
