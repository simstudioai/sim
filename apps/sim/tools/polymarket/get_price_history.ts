import type { PolymarketPriceHistoryEntry } from '@/tools/polymarket/types'
import { buildClobUrl, handlePolymarketError } from '@/tools/polymarket/types'
import type { ToolConfig } from '@/tools/types'

export interface PolymarketGetPriceHistoryParams {
  tokenId: string
  interval?: string
  fidelity?: number
  startTs?: number
  endTs?: number
}

export interface PolymarketGetPriceHistoryResponse {
  success: boolean
  output: {
    history: PolymarketPriceHistoryEntry[]
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
      description:
        'The CLOB token ID from market clobTokenIds array (e.g., "71321045679252212594626385532706912750332728571942532289631379312455583992563").',
      visibility: 'user-or-llm',
    },
    interval: {
      type: 'string',
      required: false,
      description:
        'Duration ending at current time (1m, 1h, 6h, 1d, 1w, max). Mutually exclusive with startTs/endTs.',
      visibility: 'user-or-llm',
    },
    fidelity: {
      type: 'number',
      required: false,
      description: 'Data resolution in minutes (e.g., 60 for hourly)',
      visibility: 'user-or-llm',
    },
    startTs: {
      type: 'number',
      required: false,
      description: 'Start timestamp (Unix seconds UTC)',
      visibility: 'user-or-llm',
    },
    endTs: {
      type: 'number',
      required: false,
      description: 'End timestamp (Unix seconds UTC)',
      visibility: 'user-or-llm',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      queryParams.append('market', params.tokenId)
      if (params.interval) queryParams.append('interval', params.interval)
      if (params.fidelity != null && !Number.isNaN(params.fidelity))
        queryParams.append('fidelity', String(params.fidelity))
      if (params.startTs != null && !Number.isNaN(params.startTs))
        queryParams.append('startTs', String(params.startTs))
      if (params.endTs != null && !Number.isNaN(params.endTs))
        queryParams.append('endTs', String(params.endTs))
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

    const history = data.history || (Array.isArray(data) ? data : [])

    return {
      success: true,
      output: {
        history,
      },
    }
  },

  outputs: {
    history: {
      type: 'array',
      description: 'Array of price history entries',
      items: {
        type: 'object',
        properties: {
          t: { type: 'number', description: 'Unix timestamp' },
          p: { type: 'number', description: 'Price at timestamp' },
        },
      },
    },
  },
}
