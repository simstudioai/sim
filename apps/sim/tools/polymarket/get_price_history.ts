import type { ToolConfig } from '@/tools/types'
import type { PolymarketPriceHistoryEntry } from './types'
import { buildClobUrl, handlePolymarketError } from './types'

export interface PolymarketGetPriceHistoryParams {
  tokenId: string // The token ID (CLOB token ID from market)
  interval?: string // Duration: 1m, 1h, 6h, 1d, 1w, max (mutually exclusive with startTs/endTs)
  fidelity?: number // Data resolution in minutes
  startTs?: number // Start timestamp (Unix seconds UTC)
  endTs?: number // End timestamp (Unix seconds UTC)
}

export interface PolymarketGetPriceHistoryResponse {
  success: boolean
  output: {
    history: PolymarketPriceHistoryEntry[]
    metadata: {
      operation: 'get_price_history'
      totalReturned: number
    }
    success: boolean
  }
}

export const polymarketGetPriceHistoryTool: ToolConfig<
  PolymarketGetPriceHistoryParams,
  PolymarketGetPriceHistoryResponse
> = {
  id: 'polymarket_get_price_history',
  name: 'Get Price History from Polymarket',
  description: 'Retrieve historical price data for a specific market token',
  version: '1.0.0',

  params: {
    tokenId: {
      type: 'string',
      required: true,
      description: 'The CLOB token ID (from market clobTokenIds)',
    },
    interval: {
      type: 'string',
      required: false,
      description:
        'Duration ending at current time (1m, 1h, 6h, 1d, 1w, max). Mutually exclusive with startTs/endTs.',
    },
    fidelity: {
      type: 'number',
      required: false,
      description: 'Data resolution in minutes (e.g., 60 for hourly)',
    },
    startTs: {
      type: 'number',
      required: false,
      description: 'Start timestamp (Unix seconds UTC)',
    },
    endTs: {
      type: 'number',
      required: false,
      description: 'End timestamp (Unix seconds UTC)',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      queryParams.append('market', params.tokenId)
      if (params.interval) queryParams.append('interval', params.interval)
      if (params.fidelity !== undefined) queryParams.append('fidelity', String(params.fidelity))
      if (params.startTs !== undefined) queryParams.append('startTs', String(params.startTs))
      if (params.endTs !== undefined) queryParams.append('endTs', String(params.endTs))
      return `${buildClobUrl('/prices-history')}?${queryParams.toString()}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handlePolymarketError(data, response.status, 'get_price_history')
    }

    // Response is typically { history: [...] } or just an array
    const history = data.history || (Array.isArray(data) ? data : [])

    return {
      success: true,
      output: {
        history,
        metadata: {
          operation: 'get_price_history' as const,
          totalReturned: history.length,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Price history data and metadata',
      properties: {
        history: { type: 'array', description: 'Array of price history entries' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
