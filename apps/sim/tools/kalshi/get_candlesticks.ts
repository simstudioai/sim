import type { ToolConfig } from '@/tools/types'
import type { KalshiCandlestick } from './types'
import { buildKalshiUrl, handleKalshiError } from './types'

export interface KalshiGetCandlesticksParams {
  seriesTicker: string
  ticker: string
  startTs?: number
  endTs?: number
  periodInterval?: number // 1, 60, or 1440 (1min, 1hour, 1day)
}

export interface KalshiGetCandlesticksResponse {
  success: boolean
  output: {
    candlesticks: KalshiCandlestick[]
    metadata: {
      operation: 'get_candlesticks'
      seriesTicker: string
      ticker: string
      totalReturned: number
    }
    success: boolean
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
      required: false,
      description: 'Start timestamp (Unix milliseconds)',
    },
    endTs: {
      type: 'number',
      required: false,
      description: 'End timestamp (Unix milliseconds)',
    },
    periodInterval: {
      type: 'number',
      required: false,
      description: 'Period interval: 1 (1min), 60 (1hour), or 1440 (1day)',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.startTs !== undefined) queryParams.append('start_ts', params.startTs.toString())
      if (params.endTs !== undefined) queryParams.append('end_ts', params.endTs.toString())
      if (params.periodInterval !== undefined)
        queryParams.append('period_interval', params.periodInterval.toString())

      const query = queryParams.toString()
      const url = buildKalshiUrl(
        `/series/${params.seriesTicker}/markets/${params.ticker}/candlesticks`
      )
      return query ? `${url}?${query}` : url
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
        metadata: {
          operation: 'get_candlesticks' as const,
          seriesTicker: data.series_ticker || '',
          ticker: data.ticker || '',
          totalReturned: candlesticks.length,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Candlestick data and metadata',
      properties: {
        candlesticks: { type: 'array', description: 'Array of OHLC candlestick objects' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
