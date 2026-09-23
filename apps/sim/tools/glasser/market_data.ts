import {
  COMMON_PARAMS,
  compactBody,
  glasserHeaders,
  pollRun,
  RUN_OUTPUTS,
  solutionUrl,
  transformRun,
} from '@/tools/glasser/run'
import type { GlasserMarketDataParams, GlasserResponse } from '@/tools/glasser/types'
import type { ToolConfig } from '@/tools/types'

export const marketDataTool: ToolConfig<GlasserMarketDataParams, GlasserResponse> = {
  id: 'glasser_market_data',
  name: 'Glasser Market Data',
  description:
    'US property values, rent estimates, property records, for-sale and rental listings, ZIP-code market statistics, and stock quotes. Glasser routes the call to RentCast or SerpApi.',
  version: '1.0.0',

  params: {
    action: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'property_value and property_rent take address. property_search, listings_sale and listings_rental take address, or city plus state, or zip. market_stats takes zip. stock_quote takes symbol.',
    },
    address: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Full US street address',
    },
    city: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'US city name; use with state',
    },
    state: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Two-letter US state code, e.g. TX',
    },
    zip: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Five-digit US ZIP code',
    },
    symbol: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Ticker with exchange, e.g. AAPL:NASDAQ (stock_quote)',
    },
    limit: COMMON_PARAMS.limit,
    provider: {
      ...COMMON_PARAMS.provider,
      description: `${COMMON_PARAMS.provider.description} One of auto, rentcast, serpapi.`,
    },
    task_id: COMMON_PARAMS.task_id,
    apiKey: COMMON_PARAMS.apiKey,
  },

  request: {
    url: solutionUrl('market_data'),
    method: 'POST',
    headers: (params) => glasserHeaders(params.apiKey),
    body: (params) =>
      compactBody({
        action: params.action,
        provider: params.provider,
        address: params.address,
        city: params.city,
        state: params.state,
        zip: params.zip,
        symbol: params.symbol,
        limit: params.limit,
        task_id: params.task_id,
      }),
  },

  transformResponse: transformRun,
  postProcess: async (result, params) => pollRun(result, params),

  outputs: RUN_OUTPUTS,
}
