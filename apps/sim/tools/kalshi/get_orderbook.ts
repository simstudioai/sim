import type { KalshiOrderbook } from '@/tools/kalshi/types'
import { buildKalshiUrl, handleKalshiError } from '@/tools/kalshi/types'
import type { ToolConfig } from '@/tools/types'

export interface KalshiGetOrderbookParams {
  ticker: string
}

export interface KalshiGetOrderbookResponse {
  success: boolean
  output: {
    orderbook: KalshiOrderbook
  }
}

export const kalshiGetOrderbookTool: ToolConfig<
  KalshiGetOrderbookParams,
  KalshiGetOrderbookResponse
> = {
  id: 'kalshi_get_orderbook',
  name: 'Get Market Orderbook from Kalshi',
  description: 'Retrieve the orderbook (yes and no bids) for a specific market',
  version: '1.0.0',

  params: {
    ticker: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Market ticker identifier (e.g., "KXBTC-24DEC31", "INX-25JAN03-T4485.99")',
    },
  },

  request: {
    url: (params) => buildKalshiUrl(`/markets/${params.ticker}/orderbook`),
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handleKalshiError(data, response.status, 'get_orderbook')
    }

    const orderbook = data.orderbook || { yes: [], no: [] }

    return {
      success: true,
      output: {
        orderbook,
      },
    }
  },

  outputs: {
    orderbook: {
      type: 'object',
      description: 'Orderbook with yes/no bids and asks',
    },
  },
}

/**
 * V2 Get Orderbook Tool - Returns exact Kalshi API response structure with depth param
 * API returns tuple arrays: [price, count] for orderbook, [dollars_string, count] for _dollars variants
 */
export interface KalshiGetOrderbookV2Params {
  ticker: string
  depth?: number // Number of price levels to return
}

export interface KalshiGetOrderbookV2Response {
  success: boolean
  output: {
    orderbook: {
      yes: Array<[number, number]> // [price_in_cents, count]
      no: Array<[number, number]> // [price_in_cents, count]
      yes_dollars: Array<[string, number]> // [dollars_string, count]
      no_dollars: Array<[string, number]> // [dollars_string, count]
    }
    orderbook_fp: {
      yes_dollars: Array<[string, string]> // [dollars_string, fp_count_string]
      no_dollars: Array<[string, string]> // [dollars_string, fp_count_string]
    }
  }
}

export const kalshiGetOrderbookV2Tool: ToolConfig<
  KalshiGetOrderbookV2Params,
  KalshiGetOrderbookV2Response
> = {
  id: 'kalshi_get_orderbook_v2',
  name: 'Get Market Orderbook from Kalshi V2',
  description:
    'Retrieve the orderbook (yes and no bids) for a specific market (V2 - includes depth and fp fields)',
  version: '2.0.0',

  params: {
    ticker: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Market ticker identifier (e.g., "KXBTC-24DEC31", "INX-25JAN03-T4485.99")',
    },
    depth: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of price levels to return (e.g., 10, 20). Default: all levels',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.depth) queryParams.append('depth', params.depth.toString())

      const query = queryParams.toString()
      const url = buildKalshiUrl(`/markets/${params.ticker}/orderbook`)
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
      handleKalshiError(data, response.status, 'get_orderbook_v2')
    }

    const orderbook = data.orderbook || {}
    const orderbookFp = data.orderbook_fp || {}

    return {
      success: true,
      output: {
        orderbook: {
          yes: orderbook.yes ?? [],
          no: orderbook.no ?? [],
          yes_dollars: orderbook.yes_dollars ?? [],
          no_dollars: orderbook.no_dollars ?? [],
        },
        orderbook_fp: {
          yes_dollars: orderbookFp.yes_dollars ?? [],
          no_dollars: orderbookFp.no_dollars ?? [],
        },
      },
    }
  },

  outputs: {
    orderbook: {
      type: 'object',
      description: 'Orderbook with yes/no bids (legacy integer counts)',
      properties: {
        yes: {
          type: 'array',
          description: 'Yes side bids as tuples [price_cents, count]',
        },
        no: {
          type: 'array',
          description: 'No side bids as tuples [price_cents, count]',
        },
        yes_dollars: {
          type: 'array',
          description: 'Yes side bids as tuples [dollars_string, count]',
        },
        no_dollars: {
          type: 'array',
          description: 'No side bids as tuples [dollars_string, count]',
        },
      },
    },
    orderbook_fp: {
      type: 'object',
      description: 'Orderbook with fixed-point counts (preferred)',
      properties: {
        yes_dollars: {
          type: 'array',
          description: 'Yes side bids as tuples [dollars_string, fp_count_string]',
        },
        no_dollars: {
          type: 'array',
          description: 'No side bids as tuples [dollars_string, fp_count_string]',
        },
      },
    },
  },
}
