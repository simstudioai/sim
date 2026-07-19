import type {
  AdanosMarketSentimentParams,
  AdanosMarketSentimentResponse,
  AdanosRawMarketOverview,
} from '@/tools/adanos/types'
import {
  buildAdanosUrl,
  getActivityCount,
  getAdanosBasePath,
  getAdanosHeaders,
  getAdanosSource,
  normalizeDriver,
  readAdanosResponse,
} from '@/tools/adanos/utils'
import type { ToolConfig } from '@/tools/types'

export const adanosMarketSentimentTool: ToolConfig<
  AdanosMarketSentimentParams,
  AdanosMarketSentimentResponse
> = {
  id: 'adanos_market_sentiment',
  name: 'Adanos Market Sentiment',
  description: 'Get aggregate market sentiment for stocks or cryptocurrencies',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Adanos API key',
    },
    assetType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Asset type: stocks or crypto',
    },
    source: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Stock sentiment source: reddit, x, news, or polymarket',
    },
    startDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start date in YYYY-MM-DD format',
    },
    endDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'End date in YYYY-MM-DD format',
    },
  },
  request: {
    url: (params) =>
      buildAdanosUrl(
        `${getAdanosBasePath(params.assetType, params.source)}/market-sentiment`,
        params
      ),
    method: 'GET',
    headers: (params) => getAdanosHeaders(params.apiKey),
  },
  transformResponse: async (response, params) => {
    const data = await readAdanosResponse<AdanosRawMarketOverview>(response)
    const assetType = params?.assetType ?? 'stocks'
    const source = getAdanosSource(assetType, params?.source)
    return {
      success: true,
      output: {
        assetType,
        source,
        buzzScore: data.buzz_score ?? null,
        sentimentScore: data.sentiment_score ?? null,
        trend: data.trend ?? null,
        bullishPct: data.bullish_pct ?? null,
        bearishPct: data.bearish_pct ?? null,
        activityCount: getActivityCount(data),
        activeAssets: data.active_tickers ?? 0,
        drivers: (data.drivers ?? []).map(normalizeDriver),
      },
    }
  },
  outputs: {
    assetType: { type: 'string', description: 'Asset type' },
    source: { type: 'string', description: 'Sentiment data source' },
    buzzScore: { type: 'number', description: 'Market buzz score from 0 to 100', optional: true },
    sentimentScore: {
      type: 'number',
      description: 'Aggregate sentiment score from -1 to 1',
      optional: true,
    },
    trend: { type: 'string', description: 'Current market sentiment trend', optional: true },
    bullishPct: { type: 'number', description: 'Bullish activity percentage', optional: true },
    bearishPct: { type: 'number', description: 'Bearish activity percentage', optional: true },
    activityCount: { type: 'number', description: 'Aggregate mention or trade count' },
    activeAssets: { type: 'number', description: 'Number of active assets' },
    drivers: {
      type: 'array',
      description: 'Assets contributing most to market sentiment',
      items: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Ticker or cryptocurrency symbol' },
          activityCount: { type: 'number', description: 'Mention or trade count' },
          buzzScore: { type: 'number', description: 'Buzz score from 0 to 100' },
          sentimentScore: { type: 'number', description: 'Sentiment score from -1 to 1' },
        },
      },
    },
  },
}
