import type { ToolConfig } from '@/tools/types'
import type { KalshiAuthParams, KalshiOrder } from './types'
import { buildKalshiAuthHeaders, buildKalshiUrl, handleKalshiError } from './types'

export interface KalshiAmendOrderParams extends KalshiAuthParams {
  orderId: string // Order ID to amend (required)
  ticker: string // Market ticker (required)
  side: string // 'yes' or 'no' (required)
  action: string // 'buy' or 'sell' (required)
  clientOrderId: string // Original client order ID (required)
  updatedClientOrderId: string // New client order ID (required)
  count?: string // Updated quantity
  yesPrice?: string // Updated yes price in cents (1-99)
  noPrice?: string // Updated no price in cents (1-99)
  yesPriceDollars?: string // Updated yes price in dollars
  noPriceDollars?: string // Updated no price in dollars
}

export interface KalshiAmendOrderResponse {
  success: boolean
  output: {
    order: KalshiOrder
  }
}

export const kalshiAmendOrderTool: ToolConfig<KalshiAmendOrderParams, KalshiAmendOrderResponse> = {
  id: 'kalshi_amend_order',
  name: 'Amend Order on Kalshi',
  description: 'Modify the price or quantity of an existing order on Kalshi',
  version: '1.0.0',

  params: {
    keyId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Kalshi API Key ID',
    },
    privateKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your RSA Private Key (PEM format)',
    },
    orderId: {
      type: 'string',
      required: true,
      description: 'The order ID to amend',
    },
    ticker: {
      type: 'string',
      required: true,
      description: 'Market ticker',
    },
    side: {
      type: 'string',
      required: true,
      description: "Side of the order: 'yes' or 'no'",
    },
    action: {
      type: 'string',
      required: true,
      description: "Action type: 'buy' or 'sell'",
    },
    clientOrderId: {
      type: 'string',
      required: true,
      description: 'The original client-specified order ID',
    },
    updatedClientOrderId: {
      type: 'string',
      required: true,
      description: 'The new client-specified order ID after amendment',
    },
    count: {
      type: 'string',
      required: false,
      description: 'Updated quantity for the order',
    },
    yesPrice: {
      type: 'string',
      required: false,
      description: 'Updated yes price in cents (1-99)',
    },
    noPrice: {
      type: 'string',
      required: false,
      description: 'Updated no price in cents (1-99)',
    },
    yesPriceDollars: {
      type: 'string',
      required: false,
      description: 'Updated yes price in dollars (e.g., "0.56")',
    },
    noPriceDollars: {
      type: 'string',
      required: false,
      description: 'Updated no price in dollars (e.g., "0.56")',
    },
  },

  request: {
    url: (params) => buildKalshiUrl(`/portfolio/orders/${params.orderId}/amend`),
    method: 'POST',
    headers: (params) => {
      const path = `/trade-api/v2/portfolio/orders/${params.orderId}/amend`
      return buildKalshiAuthHeaders(params.keyId, params.privateKey, 'POST', path)
    },
    body: (params) => {
      const body: Record<string, any> = {
        ticker: params.ticker,
        side: params.side.toLowerCase(),
        action: params.action.toLowerCase(),
        client_order_id: params.clientOrderId,
        updated_client_order_id: params.updatedClientOrderId,
      }

      if (params.count) body.count = Number.parseInt(params.count, 10)
      if (params.yesPrice) body.yes_price = Number.parseInt(params.yesPrice, 10)
      if (params.noPrice) body.no_price = Number.parseInt(params.noPrice, 10)
      if (params.yesPriceDollars) body.yes_price_dollars = params.yesPriceDollars
      if (params.noPriceDollars) body.no_price_dollars = params.noPriceDollars

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handleKalshiError(data, response.status, 'amend_order')
    }

    return {
      success: true,
      output: {
        order: data.order,
      },
    }
  },

  outputs: {
    order: {
      type: 'object',
      description: 'The amended order object',
    },
  },
}
