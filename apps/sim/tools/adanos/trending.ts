import type {
  AdanosRawAsset,
  AdanosTrendingParams,
  AdanosTrendingResponse,
} from '@/tools/adanos/types'
import {
  buildAdanosUrl,
  getActivityCount,
  getAdanosBasePath,
  getAdanosHeaders,
  getAdanosSource,
  readAdanosResponse,
} from '@/tools/adanos/utils'
import type { ToolConfig } from '@/tools/types'

export const adanosTrendingTool: ToolConfig<AdanosTrendingParams, AdanosTrendingResponse> = {
  id: 'adanos_trending',
  name: 'Adanos Trending Assets',
  description: 'List trending stocks or cryptocurrencies ranked by market sentiment activity',
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
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of assets to return, from 1 to 100',
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
        `${getAdanosBasePath(params.assetType, params.source)}/trending`,
        params,
        params.limit
      ),
    method: 'GET',
    headers: (params) => getAdanosHeaders(params.apiKey),
  },
  transformResponse: async (response, params) => {
    const data = await readAdanosResponse<AdanosRawAsset[]>(response)
    const assetType = params?.assetType ?? 'stocks'
    const source = getAdanosSource(assetType, params?.source)
    return {
      success: true,
      output: {
        assets: data.map((asset) => ({
          assetType,
          source,
          symbol: asset.ticker ?? asset.symbol ?? '',
          name: asset.company_name ?? asset.name ?? null,
          buzzScore: asset.buzz_score ?? null,
          sentimentScore: asset.sentiment_score ?? null,
          trend: asset.trend ?? null,
          bullishPct: asset.bullish_pct ?? null,
          bearishPct: asset.bearish_pct ?? null,
          activityCount: getActivityCount(asset),
        })),
      },
    }
  },
  outputs: {
    assets: {
      type: 'array',
      description: 'Trending assets with normalized sentiment metrics',
      items: {
        type: 'object',
        properties: {
          assetType: { type: 'string', description: 'Asset type' },
          source: { type: 'string', description: 'Sentiment data source' },
          symbol: { type: 'string', description: 'Ticker or cryptocurrency symbol' },
          name: { type: 'string', description: 'Asset name' },
          buzzScore: { type: 'number', description: 'Buzz score from 0 to 100' },
          sentimentScore: { type: 'number', description: 'Sentiment score from -1 to 1' },
          trend: { type: 'string', description: 'Current sentiment trend' },
          bullishPct: { type: 'number', description: 'Bullish activity percentage' },
          bearishPct: { type: 'number', description: 'Bearish activity percentage' },
          activityCount: { type: 'number', description: 'Mention or trade count' },
        },
      },
    },
  },
}
