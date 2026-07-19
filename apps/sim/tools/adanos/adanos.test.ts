/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { AdanosBlock } from '@/blocks/blocks/adanos'
import { adanosCryptoSentimentTool } from '@/tools/adanos/crypto_sentiment'
import { adanosMarketSentimentTool } from '@/tools/adanos/market_sentiment'
import { adanosStockSentimentTool } from '@/tools/adanos/stock_sentiment'
import { adanosTrendingTool } from '@/tools/adanos/trending'

const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

describe('Adanos request configuration', () => {
  it('builds a stock source URL with an uppercase ticker and date range', () => {
    const buildUrl = adanosStockSentimentTool.request.url as (params: {
      apiKey: string
      ticker: string
      source: 'news'
      startDate: string
      endDate: string
    }) => string

    expect(
      buildUrl({
        apiKey: 'key',
        ticker: ' aapl ',
        source: 'news',
        startDate: '2026-07-01',
        endDate: '2026-07-18',
      })
    ).toBe('https://api.adanos.org/news/stocks/v1/stock/AAPL?from=2026-07-01&to=2026-07-18')
  })

  it('uses the Reddit crypto endpoint and trims the API key', () => {
    const buildUrl = adanosCryptoSentimentTool.request.url as (params: {
      apiKey: string
      symbol: string
    }) => string
    const buildHeaders = adanosCryptoSentimentTool.request.headers as (params: {
      apiKey: string
    }) => Record<string, string>

    expect(buildUrl({ apiKey: 'key', symbol: ' eth ' })).toBe(
      'https://api.adanos.org/reddit/crypto/v1/token/ETH'
    )
    expect(buildHeaders({ apiKey: '  sk_live_test  ' })).toMatchObject({
      'X-API-Key': 'sk_live_test',
    })
  })

  it('builds a crypto trending URL with a bounded result limit', () => {
    const buildUrl = adanosTrendingTool.request.url as (params: {
      apiKey: string
      assetType: 'crypto'
      source: 'polymarket'
      limit: number
    }) => string

    expect(buildUrl({ apiKey: 'key', assetType: 'crypto', source: 'polymarket', limit: 25 })).toBe(
      'https://api.adanos.org/reddit/crypto/v1/trending?limit=25'
    )
  })

  it('rejects unsupported stock sources and out-of-range limits', () => {
    const buildStockUrl = adanosStockSentimentTool.request.url as (params: {
      apiKey: string
      ticker: string
      source: string
    }) => string
    const buildTrendingUrl = adanosTrendingTool.request.url as (params: {
      apiKey: string
      assetType: 'stocks'
      source: 'reddit'
      limit: number
    }) => string

    expect(() => buildStockUrl({ apiKey: 'key', ticker: 'AAPL', source: 'unsupported' })).toThrow(
      'Stock source must be reddit, x, news, or polymarket'
    )
    expect(() =>
      buildTrendingUrl({ apiKey: 'key', assetType: 'stocks', source: 'reddit', limit: 101 })
    ).toThrow('Result limit must be an integer from 1 to 100')
  })
})

describe('Adanos response transforms', () => {
  it('normalizes Polymarket stock activity and daily trends', async () => {
    const result = await adanosStockSentimentTool.transformResponse!(
      respond({
        ticker: 'TSLA',
        company_name: 'Tesla, Inc.',
        found: true,
        trade_count: 48,
        buzz_score: 71.2,
        sentiment_score: 0.24,
        trend: 'rising',
        bullish_pct: 63,
        bearish_pct: 21,
        period_days: 7,
        daily_trend: [
          {
            date: '2026-07-18',
            trade_count: 9,
            buzz_score: 66.1,
            sentiment_score: 0.2,
          },
        ],
      }),
      { apiKey: 'key', ticker: 'TSLA', source: 'polymarket' }
    )

    expect(result.output).toMatchObject({
      assetType: 'stocks',
      source: 'polymarket',
      symbol: 'TSLA',
      name: 'Tesla, Inc.',
      activityCount: 48,
      dailyTrend: [{ date: '2026-07-18', activityCount: 9 }],
    })
  })

  it('normalizes trending crypto assets to the shared output', async () => {
    const result = await adanosTrendingTool.transformResponse!(
      respond([
        {
          symbol: 'BTC',
          name: 'Bitcoin',
          mentions: 420,
          buzz_score: 82.4,
          sentiment_score: 0.31,
          trend: 'rising',
          bullish_pct: 61,
          bearish_pct: 17,
        },
      ]),
      { apiKey: 'key', assetType: 'crypto', source: 'news' }
    )

    expect(result.output.assets).toEqual([
      {
        assetType: 'crypto',
        source: 'reddit',
        symbol: 'BTC',
        name: 'Bitcoin',
        activityCount: 420,
        buzzScore: 82.4,
        sentimentScore: 0.31,
        trend: 'rising',
        bullishPct: 61,
        bearishPct: 17,
      },
    ])
  })

  it('normalizes market drivers without exposing source-specific raw fields', async () => {
    const result = await adanosMarketSentimentTool.transformResponse!(
      respond({
        trade_count: 210,
        active_tickers: 14,
        buzz_score: 65.5,
        sentiment_score: 0.18,
        trend: 'stable',
        drivers: [{ ticker: 'NVDA', trade_count: 33, buzz_score: 79.4, sentiment_score: 0.27 }],
      }),
      { apiKey: 'key', assetType: 'stocks', source: 'polymarket' }
    )

    expect(result.output).toMatchObject({
      source: 'polymarket',
      activityCount: 210,
      activeAssets: 14,
      drivers: [{ symbol: 'NVDA', activityCount: 33, buzzScore: 79.4, sentimentScore: 0.27 }],
    })
  })

  it('surfaces Adanos API error details', async () => {
    await expect(
      adanosCryptoSentimentTool.transformResponse!(
        respond({ detail: 'Invalid or inactive API key' }, 401)
      )
    ).rejects.toThrow('Invalid or inactive API key')
  })
})

describe('Adanos block configuration', () => {
  it('routes each operation to a registered tool and coerces the limit', () => {
    const selectTool = AdanosBlock.tools?.config?.tool as (params: { operation: string }) => string
    const mapParams = AdanosBlock.tools?.config?.params as (params: {
      operation: string
      apiKey: string
      limit: string
      source: string
      startDate: string
      endDate: string
    }) => Record<string, unknown>

    expect(selectTool({ operation: 'market_sentiment' })).toBe('adanos_market_sentiment')
    expect(
      mapParams({
        operation: 'trending',
        apiKey: 'key',
        limit: '20',
        source: '',
        startDate: '',
        endDate: '',
      })
    ).toMatchObject({ limit: 20, source: undefined, startDate: undefined, endDate: undefined })
  })
})
