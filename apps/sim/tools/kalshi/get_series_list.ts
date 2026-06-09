import type { KalshiSeries } from '@/tools/kalshi/types'
import {
  buildKalshiUrl,
  handleKalshiError,
  KALSHI_SERIES_OUTPUT_PROPERTIES,
} from '@/tools/kalshi/types'
import type { ToolConfig } from '@/tools/types'

export interface KalshiGetSeriesListParams {
  category?: string
  tags?: string
}

export interface KalshiGetSeriesListResponse {
  success: boolean
  output: {
    series: KalshiSeries[]
  }
}

export const kalshiGetSeriesListTool: ToolConfig<
  KalshiGetSeriesListParams,
  KalshiGetSeriesListResponse
> = {
  id: 'kalshi_get_series_list',
  name: 'Get Series List from Kalshi',
  description: 'Retrieve a list of market series from Kalshi with optional filtering',
  version: '1.0.0',

  params: {
    category: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by category (e.g., "Economics", "Politics", "Crypto")',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by comma-separated tags',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.category) queryParams.append('category', params.category)
      if (params.tags) queryParams.append('tags', params.tags)

      const query = queryParams.toString()
      const url = buildKalshiUrl('/series')
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
      handleKalshiError(data, response.status, 'get_series_list')
    }

    return {
      success: true,
      output: {
        series: data.series || [],
      },
    }
  },

  outputs: {
    series: {
      type: 'array',
      description: 'Array of series objects',
      items: {
        type: 'object',
        properties: KALSHI_SERIES_OUTPUT_PROPERTIES,
      },
    },
  },
}

/**
 * V2 Params for Get Series List - adds metadata/volume flags and exact response mapping
 */
export interface KalshiGetSeriesListV2Params {
  category?: string
  tags?: string
  includeProductMetadata?: string
  includeVolume?: string
  minUpdatedTs?: number
}

/**
 * V2 Response matching Kalshi API exactly
 */
export interface KalshiGetSeriesListV2Response {
  success: boolean
  output: {
    series: Array<{
      ticker: string
      frequency: string
      title: string
      category: string
      tags: string[] | null
      settlement_sources: Array<{ name: string; url: string }> | null
      contract_url: string | null
      contract_terms_url: string | null
      fee_type: string | null
      fee_multiplier: number | null
      additional_prohibitions: string[] | null
      product_metadata: Record<string, unknown> | null
      volume_fp: string | null
      last_updated_ts: string | null
    }>
  }
}

export const kalshiGetSeriesListV2Tool: ToolConfig<
  KalshiGetSeriesListV2Params,
  KalshiGetSeriesListV2Response
> = {
  id: 'kalshi_get_series_list_v2',
  name: 'Get Series List from Kalshi V2',
  description:
    'Retrieve a list of market series from Kalshi with optional filtering (V2 - exact API response)',
  version: '2.0.0',

  params: {
    category: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by category (e.g., "Economics", "Politics", "Crypto")',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by comma-separated tags',
    },
    includeProductMetadata: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include product metadata in response (true/false)',
    },
    includeVolume: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include volume data in response (true/false)',
    },
    minUpdatedTs: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Minimum updated timestamp in Unix seconds (e.g., 1704067200)',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.category) queryParams.append('category', params.category)
      if (params.tags) queryParams.append('tags', params.tags)
      if (params.includeProductMetadata)
        queryParams.append('include_product_metadata', params.includeProductMetadata)
      if (params.includeVolume) queryParams.append('include_volume', params.includeVolume)
      if (params.minUpdatedTs !== undefined)
        queryParams.append('min_updated_ts', params.minUpdatedTs.toString())

      const query = queryParams.toString()
      const url = buildKalshiUrl('/series')
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
      handleKalshiError(data, response.status, 'get_series_list_v2')
    }

    const series = (data.series || []).map((s: Record<string, unknown>) => {
      const settlementSources = s.settlement_sources
        ? (s.settlement_sources as Array<Record<string, unknown>>).map((src) => ({
            name: (src.name as string) ?? null,
            url: (src.url as string) ?? null,
          }))
        : null

      return {
        ticker: s.ticker ?? null,
        frequency: s.frequency ?? null,
        title: s.title ?? null,
        category: s.category ?? null,
        tags: s.tags ?? null,
        settlement_sources: settlementSources,
        contract_url: s.contract_url ?? null,
        contract_terms_url: s.contract_terms_url ?? null,
        fee_type: s.fee_type ?? null,
        fee_multiplier: s.fee_multiplier ?? null,
        additional_prohibitions: s.additional_prohibitions ?? null,
        product_metadata: s.product_metadata ?? null,
        volume_fp: s.volume_fp ?? null,
        last_updated_ts: s.last_updated_ts ?? null,
      }
    })

    return {
      success: true,
      output: {
        series,
      },
    }
  },

  outputs: {
    series: {
      type: 'array',
      description: 'Array of series objects with all API fields',
      items: {
        type: 'object',
        properties: KALSHI_SERIES_OUTPUT_PROPERTIES,
      },
    },
  },
}
