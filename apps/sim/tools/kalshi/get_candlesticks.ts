import type { ToolConfig } from '@/tools/types'
import type { KalshiCandlestick } from './types'
import { buildKalshiUrl, handleKalshiError } from './types'

export interface KalshiGetCandlesticksParams {
  seriesTicker: string
  ticker: string
  startTs: number
  endTs: number
  periodInterval: number // 1, 60, or 1440 (1min, 1hour, 1day)
}

export interface KalshiGetCandlesticksResponse {
  success: boolean
  output: {
    candlesticks: KalshiCandlestick[]
  }
}

export const kalshiGetCandlesticksTool: ToolConfig<
  KalshiGetCandlesticksParams,
  KalshiGetCandlesticksResponse
> = {
  id: 'kalshi_get_candlesticks',
  name: 'Get Market Candlesticks from Kalshi',
  description: 'Retrieve OHLC candlestick data for a specific market',
  version: '1.0.0',

  params: {
    seriesTicker: {
      type: 'string',
      required: true,
      description: 'Series ticker',
    },
    ticker: {
      type: 'string',
      required: true,
      description: 'Market ticker (e.g., KXBTC-24DEC31)',
    },
    startTs: {
      type: 'number',
      required: true,
      description: 'Start timestamp (Unix seconds)',
    },
    endTs: {
      type: 'number',
      required: true,
      description: 'End timestamp (Unix seconds)',
    },
    periodInterval: {
      type: 'number',
      required: true,
      description: 'Period interval: 1 (1min), 60 (1hour), or 1440 (1day)',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      queryParams.append('start_ts', params.startTs.toString())
      queryParams.append('end_ts', params.endTs.toString())
      queryParams.append('period_interval', params.periodInterval.toString())

      const query = queryParams.toString()
      const url = buildKalshiUrl(
        `/series/${params.seriesTicker}/markets/${params.ticker}/candlesticks`
      )
      return `${url}?${query}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handleKalshiError(data, response.status, 'get_candlesticks')
    }

    const candlesticks = data.candlesticks || []

    return {
      success: true,
      output: {
        candlesticks,
      },
    }
  },

  outputs: {
    candlesticks: {
      type: 'array',
      description: 'Array of OHLC candlestick data',
    },
  },
}
