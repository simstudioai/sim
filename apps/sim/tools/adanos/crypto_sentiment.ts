import type {
  AdanosCryptoSentimentParams,
  AdanosCryptoSentimentResponse,
  AdanosRawAsset,
} from '@/tools/adanos/types'
import {
  buildAdanosUrl,
  getAdanosBasePath,
  getAdanosHeaders,
  normalizeAsset,
  readAdanosResponse,
} from '@/tools/adanos/utils'
import type { ToolConfig } from '@/tools/types'

export const adanosCryptoSentimentTool: ToolConfig<
  AdanosCryptoSentimentParams,
  AdanosCryptoSentimentResponse
> = {
  id: 'adanos_crypto_sentiment',
  name: 'Adanos Crypto Sentiment',
  description: 'Get Reddit market sentiment for a cryptocurrency',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Adanos API key',
    },
    symbol: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Cryptocurrency symbol, such as BTC',
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
        `${getAdanosBasePath('crypto')}/token/${encodeURIComponent(params.symbol.trim().toUpperCase())}`,
        params
      ),
    method: 'GET',
    headers: (params) => getAdanosHeaders(params.apiKey),
  },
  transformResponse: async (response) => {
    const data = await readAdanosResponse<AdanosRawAsset>(response)
    return { success: true, output: normalizeAsset(data, 'crypto', 'reddit') }
  },
  outputs: {
    assetType: { type: 'string', description: 'Asset type' },
    source: { type: 'string', description: 'Sentiment data source' },
    symbol: { type: 'string', description: 'Cryptocurrency symbol' },
    name: { type: 'string', description: 'Cryptocurrency name', optional: true },
    found: { type: 'boolean', description: 'Whether sentiment data was found' },
    buzzScore: { type: 'number', description: 'Buzz score from 0 to 100', optional: true },
    sentimentScore: {
      type: 'number',
      description: 'Sentiment score from -1 to 1',
      optional: true,
    },
    trend: { type: 'string', description: 'Current sentiment trend', optional: true },
    bullishPct: { type: 'number', description: 'Bullish mention percentage', optional: true },
    bearishPct: { type: 'number', description: 'Bearish mention percentage', optional: true },
    activityCount: { type: 'number', description: 'Reddit mention count' },
    periodDays: { type: 'number', description: 'Number of days in the period', optional: true },
    dailyTrend: { type: 'json', description: 'Normalized daily sentiment trend' },
  },
}
