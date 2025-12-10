import type { ToolConfig } from '@/tools/types'
import type { KalshiSeries } from './types'
import { buildKalshiUrl, handleKalshiError } from './types'

export interface KalshiGetSeriesByTickerParams {
  seriesTicker: string
}

export interface KalshiGetSeriesByTickerResponse {
  success: boolean
  output: {
    series: KalshiSeries
  }
}

export const kalshiGetSeriesByTickerTool: ToolConfig<
  KalshiGetSeriesByTickerParams,
  KalshiGetSeriesByTickerResponse
> = {
  id: 'kalshi_get_series_by_ticker',
  name: 'Get Series by Ticker from Kalshi',
  description: 'Retrieve details of a specific market series by ticker',
  version: '1.0.0',

  params: {
    seriesTicker: {
      type: 'string',
      required: true,
      description: 'Series ticker',
    },
  },

  request: {
    url: (params) => {
      return buildKalshiUrl(`/series/${params.seriesTicker}`)
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handleKalshiError(data, response.status, 'get_series_by_ticker')
    }

    const series = data.series || data

    return {
      success: true,
      output: {
        series,
      },
    }
  },

  outputs: {
    series: {
      type: 'object',
      description: 'Series object with details',
    },
  },
}
