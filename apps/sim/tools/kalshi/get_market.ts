import type { ToolConfig } from '@/tools/types'
import type { KalshiMarket } from './types'
import { buildKalshiUrl, handleKalshiError } from './types'

export interface KalshiGetMarketParams {
  ticker: string // Market ticker
}

export interface KalshiGetMarketResponse {
  success: boolean
  output: {
    market: KalshiMarket
  }
}

export const kalshiGetMarketTool: ToolConfig<KalshiGetMarketParams, KalshiGetMarketResponse> = {
  id: 'kalshi_get_market',
  name: 'Get Market from Kalshi',
  description: 'Retrieve details of a specific prediction market by ticker',
  version: '1.0.0',

  params: {
    ticker: {
      type: 'string',
      required: true,
      description: 'The market ticker (e.g., "KXBTC-24DEC31")',
    },
  },

  request: {
    url: (params) => buildKalshiUrl(`/markets/${params.ticker}`),
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handleKalshiError(data, response.status, 'get_market')
    }

    return {
      success: true,
      output: {
        market: data.market,
      },
    }
  },

  outputs: {
    market: {
      type: 'object',
      description: 'Market object with details',
    },
  },
}
