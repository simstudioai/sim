import type { KalshiAuthParams, KalshiOrder } from '@/tools/kalshi/types'
import { buildKalshiAuthHeaders, buildKalshiUrl, handleKalshiError } from '@/tools/kalshi/types'
import type { ToolConfig } from '@/tools/types'

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
        visibility: 'user-or-llm',
        description: 'Market ticker identifier (e.g., "KXBTC-24DEC31", "INX-25JAN03-T4485.99")',
      },
      side: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Side of the order: "yes" or "no"',
      },
      action: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Action type: "buy" or "sell"',
      },
      count: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Number of contracts to trade (e.g., "10", "100")',
      },
      type: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Order type: "limit" or "market" (default: "limit")',
      },
      yesPrice: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Yes price in cents (1-99)',
      },
      noPrice: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'No price in cents (1-99)',
      },
      yesPriceDollars: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Yes price in dollars (e.g., "0.56")',
      },
      noPriceDollars: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'No price in dollars (e.g., "0.56")',
      },
      clientOrderId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Custom order identifier',
      },
      expirationTs: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Unix timestamp for order expiration',
      },
      timeInForce: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: "Time in force: 'fill_or_kill', 'good_till_canceled', 'immediate_or_cancel'",
      },
      buyMaxCost: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Maximum cost in cents (auto-enables fill_or_kill)',
      },
      postOnly: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: "Set to 'true' for maker-only orders",
      },
      reduceOnly: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: "Set to 'true' for position reduction only",
      },
      selfTradePreventionType: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: "Self-trade prevention: 'taker_at_cross' or 'maker'",
      },
      orderGroupId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
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

export interface KalshiCreateOrderV2Params extends KalshiAuthParams {
  ticker: string // Market ticker (required)
  side: string // 'yes' or 'no' (required)
  action: string // 'buy' or 'sell' (required)
  count?: string // Number of contracts (optional - provide count or countFp)
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
  countFp?: string // Count in fixed-point (for fractional contracts)
  cancelOrderOnPause?: string // 'true' or 'false' - cancel on market pause
  subaccount?: string // Subaccount to use for the order
}

export interface KalshiCreateOrderV2Response {
  success: boolean
  output: {
    order: {
      order_id: string
      user_id: string | null
      client_order_id: string | null
      ticker: string
      side: string
      action: string
      type: string
      status: string
      yes_price: number | null
      no_price: number | null
      yes_price_dollars: string | null
      no_price_dollars: string | null
      fill_count: number | null
      fill_count_fp: string | null
      remaining_count: number | null
      remaining_count_fp: string | null
      initial_count: number | null
      initial_count_fp: string | null
      taker_fees: number | null
      maker_fees: number | null
      taker_fees_dollars: string | null
      maker_fees_dollars: string | null
      taker_fill_cost: number | null
      maker_fill_cost: number | null
      taker_fill_cost_dollars: string | null
      maker_fill_cost_dollars: string | null
      queue_position: number | null
      expiration_time: string | null
      created_time: string | null
      last_update_time: string | null
      self_trade_prevention_type: string | null
      order_group_id: string | null
      cancel_order_on_pause: boolean | null
    }
  }
}

export const kalshiCreateOrderV2Tool: ToolConfig<
  KalshiCreateOrderV2Params,
  KalshiCreateOrderV2Response
> = {
  id: 'kalshi_create_order_v2',
  name: 'Create Order on Kalshi V2',
  description: 'Create a new order on a Kalshi prediction market (V2 with full API response)',
  version: '2.0.0',

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
      visibility: 'user-or-llm',
      description: 'Market ticker identifier (e.g., "KXBTC-24DEC31", "INX-25JAN03-T4485.99")',
    },
    side: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Side of the order: "yes" or "no"',
    },
    action: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Action type: "buy" or "sell"',
    },
    count: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of contracts to trade (e.g., "10", "100"). Provide count or countFp',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Order type: "limit" or "market" (default: "limit")',
    },
    yesPrice: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Yes price in cents (1-99)',
    },
    noPrice: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'No price in cents (1-99)',
    },
    yesPriceDollars: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Yes price in dollars (e.g., "0.56")',
    },
    noPriceDollars: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'No price in dollars (e.g., "0.56")',
    },
    clientOrderId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom order identifier',
    },
    expirationTs: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Unix timestamp for order expiration',
    },
    timeInForce: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Time in force: 'fill_or_kill', 'good_till_canceled', 'immediate_or_cancel'",
    },
    buyMaxCost: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum cost in cents (auto-enables fill_or_kill)',
    },
    postOnly: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Set to 'true' for maker-only orders",
    },
    reduceOnly: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Set to 'true' for position reduction only",
    },
    selfTradePreventionType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Self-trade prevention: 'taker_at_cross' or 'maker'",
    },
    orderGroupId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Associated order group ID',
    },
    countFp: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Count in fixed-point for fractional contracts',
    },
    cancelOrderOnPause: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Set to 'true' to cancel order on market pause",
    },
    subaccount: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Subaccount to use for the order',
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
      }

      // count or count_fp must be provided (but not both required)
      if (params.count) body.count = Number.parseInt(params.count, 10)
      if (params.countFp) body.count_fp = params.countFp
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
      if (params.cancelOrderOnPause)
        body.cancel_order_on_pause = params.cancelOrderOnPause === 'true'
      if (params.subaccount) body.subaccount = params.subaccount

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handleKalshiError(data, response.status, 'create_order_v2')
    }

    const order = data.order || {}

    return {
      success: true,
      output: {
        order: {
          order_id: order.order_id ?? null,
          user_id: order.user_id ?? null,
          client_order_id: order.client_order_id ?? null,
          ticker: order.ticker ?? null,
          side: order.side ?? null,
          action: order.action ?? null,
          type: order.type ?? null,
          status: order.status ?? null,
          yes_price: order.yes_price ?? null,
          no_price: order.no_price ?? null,
          yes_price_dollars: order.yes_price_dollars ?? null,
          no_price_dollars: order.no_price_dollars ?? null,
          fill_count: order.fill_count ?? null,
          fill_count_fp: order.fill_count_fp ?? null,
          remaining_count: order.remaining_count ?? null,
          remaining_count_fp: order.remaining_count_fp ?? null,
          initial_count: order.initial_count ?? null,
          initial_count_fp: order.initial_count_fp ?? null,
          taker_fees: order.taker_fees ?? null,
          maker_fees: order.maker_fees ?? null,
          taker_fees_dollars: order.taker_fees_dollars ?? null,
          maker_fees_dollars: order.maker_fees_dollars ?? null,
          taker_fill_cost: order.taker_fill_cost ?? null,
          maker_fill_cost: order.maker_fill_cost ?? null,
          taker_fill_cost_dollars: order.taker_fill_cost_dollars ?? null,
          maker_fill_cost_dollars: order.maker_fill_cost_dollars ?? null,
          queue_position: order.queue_position ?? null,
          expiration_time: order.expiration_time ?? null,
          created_time: order.created_time ?? null,
          last_update_time: order.last_update_time ?? null,
          self_trade_prevention_type: order.self_trade_prevention_type ?? null,
          order_group_id: order.order_group_id ?? null,
          cancel_order_on_pause: order.cancel_order_on_pause ?? null,
        },
      },
    }
  },

  outputs: {
    order: {
      type: 'object',
      description: 'The created order object with full API response fields',
      properties: {
        order_id: { type: 'string', description: 'Order ID' },
        user_id: { type: 'string', description: 'User ID' },
        client_order_id: { type: 'string', description: 'Client order ID' },
        ticker: { type: 'string', description: 'Market ticker' },
        side: { type: 'string', description: 'Order side (yes/no)' },
        action: { type: 'string', description: 'Action (buy/sell)' },
        type: { type: 'string', description: 'Order type (limit/market)' },
        status: { type: 'string', description: 'Order status (resting/canceled/executed)' },
        yes_price: { type: 'number', description: 'Yes price in cents' },
        no_price: { type: 'number', description: 'No price in cents' },
        yes_price_dollars: { type: 'string', description: 'Yes price in dollars' },
        no_price_dollars: { type: 'string', description: 'No price in dollars' },
        fill_count: { type: 'number', description: 'Filled contract count' },
        fill_count_fp: { type: 'string', description: 'Filled count (fixed-point)' },
        remaining_count: { type: 'number', description: 'Remaining contracts' },
        remaining_count_fp: { type: 'string', description: 'Remaining count (fixed-point)' },
        initial_count: { type: 'number', description: 'Initial contract count' },
        initial_count_fp: { type: 'string', description: 'Initial count (fixed-point)' },
        taker_fees: { type: 'number', description: 'Taker fees in cents' },
        maker_fees: { type: 'number', description: 'Maker fees in cents' },
        taker_fees_dollars: { type: 'string', description: 'Taker fees in dollars' },
        maker_fees_dollars: { type: 'string', description: 'Maker fees in dollars' },
        taker_fill_cost: { type: 'number', description: 'Taker fill cost in cents' },
        maker_fill_cost: { type: 'number', description: 'Maker fill cost in cents' },
        taker_fill_cost_dollars: { type: 'string', description: 'Taker fill cost in dollars' },
        maker_fill_cost_dollars: { type: 'string', description: 'Maker fill cost in dollars' },
        queue_position: { type: 'number', description: 'Queue position (deprecated)' },
        expiration_time: { type: 'string', description: 'Order expiration time' },
        created_time: { type: 'string', description: 'Order creation time' },
        last_update_time: { type: 'string', description: 'Last update time' },
        self_trade_prevention_type: { type: 'string', description: 'Self-trade prevention type' },
        order_group_id: { type: 'string', description: 'Order group ID' },
        cancel_order_on_pause: { type: 'boolean', description: 'Cancel on market pause' },
      },
    },
  },
}
