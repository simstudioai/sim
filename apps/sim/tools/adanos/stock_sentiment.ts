import type {
  AdanosRawAsset,
  AdanosStockSentimentParams,
  AdanosStockSentimentResponse,
} from '@/tools/adanos/types'
import {
  buildAdanosUrl,
  getAdanosBasePath,
  getAdanosHeaders,
  normalizeAsset,
  readAdanosResponse,
} from '@/tools/adanos/utils'
import type { ToolConfig } from '@/tools/types'

export const adanosStockSentimentTool: ToolConfig<
  AdanosStockSentimentParams,
  AdanosStockSentimentResponse
> = {
  id: 'adanos_stock_sentiment',
  name: 'Adanos Stock Sentiment',
  description: 'Get stock sentiment from Reddit, X / FinTwit, news, or Polymarket',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Adanos API key',
    },
    ticker: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'US stock ticker symbol, such as AAPL',
    },
    source: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Sentiment source: reddit, x, news, or polymarket',
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
        `${getAdanosBasePath('stocks', params.source)}/stock/${encodeURIComponent(params.ticker.trim().toUpperCase())}`,
        params
      ),
    method: 'GET',
    headers: (params) => getAdanosHeaders(params.apiKey),
  },
  transformResponse: async (response, params) => {
    const data = await readAdanosResponse<AdanosRawAsset>(response)
    return { success: true, output: normalizeAsset(data, 'stocks', params?.source ?? 'reddit') }
  },
  outputs: {
    assetType: { type: 'string', description: 'Asset type' },
    source: { type: 'string', description: 'Sentiment data source' },
    symbol: { type: 'string', description: 'Stock ticker symbol' },
    name: { type: 'string', description: 'Company name', optional: true },
    found: { type: 'boolean', description: 'Whether sentiment data was found' },
    buzzScore: { type: 'number', description: 'Buzz score from 0 to 100', optional: true },
    sentimentScore: {
      type: 'number',
      description: 'Sentiment score from -1 to 1',
      optional: true,
    },
    trend: { type: 'string', description: 'Current sentiment trend', optional: true },
    bullishPct: { type: 'number', description: 'Bullish activity percentage', optional: true },
    bearishPct: { type: 'number', description: 'Bearish activity percentage', optional: true },
    activityCount: { type: 'number', description: 'Mention or trade count' },
    periodDays: { type: 'number', description: 'Number of days in the period', optional: true },
    dailyTrend: { type: 'json', description: 'Normalized daily sentiment trend' },
  },
}
