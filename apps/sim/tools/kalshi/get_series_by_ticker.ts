import type { KalshiSeries } from '@/tools/kalshi/types'
import { buildKalshiUrl, handleKalshiError } from '@/tools/kalshi/types'
import type { ToolConfig } from '@/tools/types'

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
      visibility: 'user-or-llm',
      description: 'Series ticker identifier (e.g., "KXBTC", "INX", "FED-RATE")',
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

/**
 * V2 Params for Get Series by Ticker
 */
export interface KalshiGetSeriesByTickerV2Params {
  seriesTicker: string
  includeVolume?: string
}

/**
 * V2 Response matching Kalshi API exactly
 */
export interface KalshiGetSeriesByTickerV2Response {
  success: boolean
  output: {
    series: {
      ticker: string
      title: string
      frequency: string
      category: string
      tags: string[] | null
      settlement_sources: Array<{
        name: string
        url: string
      }> | null
      contract_url: string | null
      contract_terms_url: string | null
      fee_type: string | null
      fee_multiplier: number | null
      additional_prohibitions: string[] | null
      product_metadata: Record<string, unknown> | null
      volume: number | null
      volume_fp: number | null
    }
  }
}

export const kalshiGetSeriesByTickerV2Tool: ToolConfig<
  KalshiGetSeriesByTickerV2Params,
  KalshiGetSeriesByTickerV2Response
> = {
  id: 'kalshi_get_series_by_ticker_v2',
  name: 'Get Series by Ticker from Kalshi V2',
  description: 'Retrieve details of a specific market series by ticker (V2 - exact API response)',
  version: '2.0.0',

  params: {
    seriesTicker: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Series ticker identifier (e.g., "KXBTC", "INX", "FED-RATE")',
    },
    includeVolume: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include volume data in response (true/false)',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.includeVolume) queryParams.append('include_volume', params.includeVolume)

      const query = queryParams.toString()
      const url = buildKalshiUrl(`/series/${params.seriesTicker}`)
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
      handleKalshiError(data, response.status, 'get_series_by_ticker_v2')
    }

    const series = data.series || data

    const settlementSources = series.settlement_sources
      ? (series.settlement_sources as Array<Record<string, unknown>>).map((s) => ({
          name: (s.name as string) ?? null,
          url: (s.url as string) ?? null,
        }))
      : null

    return {
      success: true,
      output: {
        series: {
          ticker: series.ticker ?? null,
          title: series.title ?? null,
          frequency: series.frequency ?? null,
          category: series.category ?? null,
          tags: series.tags ?? null,
          settlement_sources: settlementSources,
          contract_url: series.contract_url ?? null,
          contract_terms_url: series.contract_terms_url ?? null,
          fee_type: series.fee_type ?? null,
          fee_multiplier: series.fee_multiplier ?? null,
          additional_prohibitions: series.additional_prohibitions ?? null,
          product_metadata: series.product_metadata ?? null,
          volume: series.volume ?? null,
          volume_fp: series.volume_fp ?? null,
        },
      },
    }
  },

  outputs: {
    series: {
      type: 'object',
      description: 'Series object with full details matching Kalshi API response',
      properties: {
        ticker: { type: 'string', description: 'Series ticker' },
        title: { type: 'string', description: 'Series title' },
        frequency: { type: 'string', description: 'Event frequency' },
        category: { type: 'string', description: 'Series category' },
        tags: { type: 'array', description: 'Series tags' },
        settlement_sources: { type: 'array', description: 'Settlement sources' },
        contract_url: { type: 'string', description: 'Contract URL' },
        contract_terms_url: { type: 'string', description: 'Contract terms URL' },
        fee_type: { type: 'string', description: 'Fee type' },
        fee_multiplier: { type: 'number', description: 'Fee multiplier' },
        additional_prohibitions: { type: 'array', description: 'Additional prohibitions' },
        product_metadata: { type: 'object', description: 'Product metadata' },
        volume: { type: 'number', description: 'Series volume' },
        volume_fp: { type: 'number', description: 'Volume (fixed-point)' },
      },
    },
  },
}
