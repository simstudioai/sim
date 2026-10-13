import { jsonResponse } from '@sim/testing/helpers/http'
import { describe, expect, it } from 'vitest'
import { webzSearchTool } from '@/tools/webz/search'
import type { WebzSearchParams } from '@/tools/webz/types'

function requestBody(params: Partial<WebzSearchParams> = {}) {
  const body = webzSearchTool.request.body
  if (!body) throw new Error('Webz search request body is missing')
  return body({ apiKey: 'test-key', query: 'Renewable energy investment', ...params })
}

function transform(payload: unknown) {
  const transformResponse = webzSearchTool.transformResponse
  if (!transformResponse) throw new Error('Webz search response transform is missing')
  return transformResponse(jsonResponse(payload))
}

describe('Webz news search request', () => {
  it('translates filters without splitting category labels or dropping a zero score threshold', () => {
    expect(
      requestBody({
        query: '  Renewable energy investment  ',
        k: 100,
        publishedAfter: '2026-10-01',
        publishedBefore: '2026-10-13',
        language: ['english'],
        country: ['US', 'GB'],
        source: [' reuters.com ', 'bbc.com'],
        sentiment: ['positive'],
        category: ['Economy, Business and Finance'],
        scoreGte: 0,
        scoreLte: 10,
      })
    ).toEqual({
      query: 'Renewable energy investment',
      k: 100,
      score_gte: 0,
      score_lte: 10,
      filters: {
        published_from: '2026-10-01',
        published_to: '2026-10-13',
        language: ['english'],
        country: ['US', 'GB'],
        domain: ['reuters.com', 'bbc.com'],
        sentiment: ['positive'],
        category: ['Economy, Business and Finance'],
      },
    })
  })

  it('omits empty filters so optional editor inputs do not constrain the search', () => {
    expect(requestBody({ language: [], country: ['  '], source: [], publishedAfter: '' })).toEqual({
      query: 'Renewable energy investment',
    })
  })

  it.each([0, 101, 1.5, Number.NaN])('rejects invalid result limit %s', (k) => {
    expect(() => requestBody({ k })).toThrow('k must be an integer between 1 and 100')
  })

  it.each([
    { scoreGte: -1 },
    { scoreLte: 11 },
    { scoreGte: Number.NaN },
    { scoreGte: 7, scoreLte: 3 },
  ])('rejects invalid score bounds %j', (scores) => {
    expect(() => requestBody(scores)).toThrow(/score/i)
  })

  it.each(['   ', 'x'.repeat(751), Array(101).fill('word').join(' ')])(
    'rejects empty or oversized queries before a paid search',
    (query) => {
      expect(() => requestBody({ query })).toThrow(/query/i)
    }
  )
})

describe('Webz news search response', () => {
  it('preserves article, matching passage, relevance, and usage across the JSON boundary', async () => {
    const result = await transform({
      query: 'Renewable energy investment',
      total_results: 1,
      requests_left: 500,
      credits_used: 1,
      results: [
        {
          score: 8.4,
          article: {
            article_id: 'article-123',
            url: 'https://example.com/renewables',
            title: 'New renewable investment',
            published_at: '2026-10-12T10:30:00.000+03:00',
            summary: 'Investment in renewable energy increased.',
            main_image: 'https://example.com/renewables.jpg',
          },
          chunk: { chunk_id: 'chunk-456', chunk_index: 0, text: 'Investment rose by 12%.' },
          metadata: {
            language: 'english',
            country: 'US',
            category: ['Economy, Business and Finance'],
            sentiment: 'positive',
            domain: 'example.com',
            site_type: 'news',
            topic: ['Renewable energy'],
            person: [],
            organization: ['Example Energy'],
            location: ['United States'],
            ticker: ['EXM'],
            source_type: 'newsroom',
            political_bias: 'center',
            trust_category: 'trusted_news',
            domain_rank: 150,
          },
        },
      ],
    })

    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({
      query: 'Renewable energy investment',
      total_results: 1,
      requests_left: 500,
      credits_used: 1,
      results: [
        {
          score: 8.4,
          article: {
            article_id: 'article-123',
            url: 'https://example.com/renewables',
            title: 'New renewable investment',
            published_at: '2026-10-12T10:30:00.000+03:00',
          },
          chunk: { chunk_id: 'chunk-456', chunk_index: 0, text: 'Investment rose by 12%.' },
          metadata: {
            domain: 'example.com',
            category: ['Economy, Business and Finance'],
            organization: ['Example Energy'],
            domain_rank: 150,
          },
        },
      ],
    })
  })

  it('normalizes missing enrichment without inventing usage credits', async () => {
    const result = await transform({
      query: 'Renewable energy investment',
      total_results: 1,
      results: [
        {
          score: 0,
          article: {
            article_id: 'article-123',
            url: 'https://example.com/renewables',
            title: 'New renewable investment',
            published_at: '2026-10-12T07:30:00Z',
          },
          chunk: { chunk_id: 'chunk-456', text: 'Investment rose by 12%.' },
        },
      ],
    })

    expect(result.output.requests_left).toBeNull()
    expect(result.output.credits_used).toBeNull()
    expect(result.output.results).toMatchObject([
      {
        score: 0,
        article: { summary: null, main_image: null },
        chunk: { chunk_index: null },
        metadata: { domain: null, domain_rank: null, category: [], topic: [] },
      },
    ])
  })

  it('preserves partial articles and passages when individual fields are unavailable', async () => {
    const result = await transform({
      query: 'Renewable energy investment',
      total_results: 1,
      results: [
        {
          score: 7,
          article: { article_id: null, url: 'https://example.com/renewables', title: null },
          chunk: { chunk_id: null, text: 'Investment rose by 12%.' },
        },
      ],
    })

    expect(result.output.results).toMatchObject([
      {
        score: 7,
        article: {
          article_id: null,
          url: 'https://example.com/renewables',
          title: null,
          published_at: null,
          summary: null,
          main_image: null,
        },
        chunk: { chunk_id: null, chunk_index: null, text: 'Investment rose by 12%.' },
      },
    ])
  })

  it('keeps an empty search distinct from a malformed response', async () => {
    await expect(
      transform({ query: 'No matching articles', total_results: 0, results: [], credits_used: 0 })
    ).resolves.toMatchObject({
      success: true,
      output: { total_results: 0, results: [], credits_used: 0, requests_left: null },
    })
  })

  it.each([
    { detail: 'Unexpected upstream error' },
    { query: 'news', total_results: 1, results: {} },
    { query: 'news', total_results: 1, results: [null] },
  ])('rejects invalid success envelopes instead of returning empty news', async (payload) => {
    await expect(transform(payload)).rejects.toThrow('Invalid Webz.io News Search response')
  })
})
