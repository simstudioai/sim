import type { ToolConfig } from '@/tools/types'
import type { KalshiAuthParams, KalshiOrder } from './types'
import { buildKalshiAuthHeaders, buildKalshiUrl, handleKalshiError } from './types'

export interface KalshiCreateOrderParams extends KalshiAuthParams {
  ticker: string // Market ticker (required)
  side: string // 'yes' or 'no' (required)
  action: string // 'buy' or 'sell' (required)
  count: string // Number of contracts (required)
  type?: string // 'limit' or 'market' (default: limit)
  yesPrice?: string // Yes price in cents (1-99)
  noPrice?: string // No price in cents (1-99)
  yesPriceDollars?: string // Yes price in dollars (e.g., "0.56")
  noPriceDollars?: string // No price in dollars (e.g., "0.56")
  clientOrderId?: string // Custom order identifier
  expirationTs?: string // Unix timestamp expiration
  timeInForce?: string // 'fill_or_kill', 'good_till_canceled', 'immediate_or_cancel'
  buyMaxCost?: string // Maximum cost in cents
  postOnly?: string // 'true' or 'false' - maker-only orders
  reduceOnly?: string // 'true' or 'false' - position reduction only
  selfTradePreventionType?: string // 'taker_at_cross' or 'maker'
  orderGroupId?: string // Associated order group
}

export interface KalshiCreateOrderResponse {
  success: boolean
  output: {
    order: KalshiOrder
  }
}

export const kalshiCreateOrderTool: ToolConfig<KalshiCreateOrderParams, KalshiCreateOrderResponse> =
  {
    id: 'kalshi_create_order',
    name: 'Create Order on Kalshi',
    description: 'Create a new order on a Kalshi prediction market',
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
      ticker: {
        type: 'string',
        required: true,
        description: 'Market ticker (e.g., KXBTC-24DEC31)',
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
      count: {
        type: 'string',
        required: true,
        description: 'Number of contracts (minimum 1)',
      },
      type: {
        type: 'string',
        required: false,
        description: "Order type: 'limit' or 'market' (default: limit)",
      },
      yesPrice: {
        type: 'string',
        required: false,
        description: 'Yes price in cents (1-99)',
      },
      noPrice: {
        type: 'string',
        required: false,
        description: 'No price in cents (1-99)',
      },
      yesPriceDollars: {
        type: 'string',
        required: false,
        description: 'Yes price in dollars (e.g., "0.56")',
      },
      noPriceDollars: {
        type: 'string',
        required: false,
        description: 'No price in dollars (e.g., "0.56")',
      },
      clientOrderId: {
        type: 'string',
        required: false,
        description: 'Custom order identifier',
      },
      expirationTs: {
        type: 'string',
        required: false,
        description: 'Unix timestamp for order expiration',
      },
      timeInForce: {
        type: 'string',
        required: false,
        description: "Time in force: 'fill_or_kill', 'good_till_canceled', 'immediate_or_cancel'",
      },
      buyMaxCost: {
        type: 'string',
        required: false,
        description: 'Maximum cost in cents (auto-enables fill_or_kill)',
      },
      postOnly: {
        type: 'string',
        required: false,
        description: "Set to 'true' for maker-only orders",
      },
      reduceOnly: {
        type: 'string',
        required: false,
        description: "Set to 'true' for position reduction only",
      },
      selfTradePreventionType: {
        type: 'string',
        required: false,
        description: "Self-trade prevention: 'taker_at_cross' or 'maker'",
      },
      orderGroupId: {
        type: 'string',
        required: false,
        description: 'Associated order group ID',
      },
    },

    request: {
      url: () => buildKalshiUrl('/portfolio/orders'),
      method: 'POST',
      headers: (params) => {
        const path = '/trade-api/v2/portfolio/orders'
        return buildKalshiAuthHeaders(params.keyId, params.privateKey, 'POST', path)
      },
      body: (params) => {
        const body: Record<string, any> = {
          ticker: params.ticker,
          side: params.side.toLowerCase(),
          action: params.action.toLowerCase(),
          count: Number.parseInt(params.count, 10),
        }

        if (params.type) body.type = params.type.toLowerCase()
        if (params.yesPrice) body.yes_price = Number.parseInt(params.yesPrice, 10)
        if (params.noPrice) body.no_price = Number.parseInt(params.noPrice, 10)
        if (params.yesPriceDollars) body.yes_price_dollars = params.yesPriceDollars
        if (params.noPriceDollars) body.no_price_dollars = params.noPriceDollars
        if (params.clientOrderId) body.client_order_id = params.clientOrderId
        if (params.expirationTs) body.expiration_ts = Number.parseInt(params.expirationTs, 10)
        if (params.timeInForce) body.time_in_force = params.timeInForce
        if (params.buyMaxCost) body.buy_max_cost = Number.parseInt(params.buyMaxCost, 10)
        if (params.postOnly) body.post_only = params.postOnly === 'true'
        if (params.reduceOnly) body.reduce_only = params.reduceOnly === 'true'
        if (params.selfTradePreventionType)
          body.self_trade_prevention_type = params.selfTradePreventionType
        if (params.orderGroupId) body.order_group_id = params.orderGroupId

        return body
      },
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!response.ok) {
        handleKalshiError(data, response.status, 'create_order')
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
        description: 'The created order object',
      },
    },
  }
