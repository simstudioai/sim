import type { KalshiAuthParams, KalshiOrder } from '@/tools/kalshi/types'
import { buildKalshiAuthHeaders, buildKalshiUrl, handleKalshiError } from '@/tools/kalshi/types'
import type { ToolConfig } from '@/tools/types'

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
      visibility: 'user-or-llm',
      description: 'Order ID to amend (e.g., "abc123-def456-ghi789")',
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
    clientOrderId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Original client-specified order ID',
    },
    updatedClientOrderId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New client-specified order ID after amendment',
    },
    count: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated quantity for the order (e.g., "10", "100")',
    },
    yesPrice: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated yes price in cents (1-99)',
    },
    noPrice: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated no price in cents (1-99)',
    },
    yesPriceDollars: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated yes price in dollars (e.g., "0.56")',
    },
    noPriceDollars: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
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

export interface KalshiAmendOrderV2Params extends KalshiAuthParams {
  orderId: string // Order ID to amend (required)
  ticker: string // Market ticker (required)
  side: string // 'yes' or 'no' (required)
  action: string // 'buy' or 'sell' (required)
  clientOrderId?: string // Original client order ID (optional in V2)
  updatedClientOrderId?: string // New client order ID (optional in V2)
  count?: string // Updated quantity
  yesPrice?: string // Updated yes price in cents (1-99)
  noPrice?: string // Updated no price in cents (1-99)
  yesPriceDollars?: string // Updated yes price in dollars
  noPriceDollars?: string // Updated no price in dollars
  countFp?: string // Count in fixed-point for fractional contracts
}

export interface KalshiAmendOrderV2Order {
  order_id: string
  user_id: string | null
  ticker: string
  event_ticker: string
  status: string
  side: string
  type: string
  yes_price: number | null
  no_price: number | null
  action: string
  count: number
  remaining_count: number
  created_time: string
  expiration_time: string | null
  order_group_id: string | null
  client_order_id: string | null
  place_count: number | null
  decrease_count: number | null
  queue_position: number | null
  maker_fill_count: number | null
  taker_fill_count: number | null
  maker_fees: number | null
  taker_fees: number | null
  last_update_time: string | null
  take_profit_order_id: string | null
  stop_loss_order_id: string | null
  amend_count: number | null
  amend_taker_fill_count: number | null
}

export interface KalshiAmendOrderV2Response {
  success: boolean
  output: {
    old_order: KalshiAmendOrderV2Order
    order: KalshiAmendOrderV2Order
  }
}

export const kalshiAmendOrderV2Tool: ToolConfig<
  KalshiAmendOrderV2Params,
  KalshiAmendOrderV2Response
> = {
  id: 'kalshi_amend_order_v2',
  name: 'Amend Order on Kalshi V2',
  description:
    'Modify the price or quantity of an existing order on Kalshi (V2 with full API response)',
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
    orderId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Order ID to amend (e.g., "abc123-def456-ghi789")',
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
    clientOrderId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Original client-specified order ID',
    },
    updatedClientOrderId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New client-specified order ID after amendment',
    },
    count: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated quantity for the order (e.g., "10", "100")',
    },
    yesPrice: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated yes price in cents (1-99)',
    },
    noPrice: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated no price in cents (1-99)',
    },
    yesPriceDollars: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated yes price in dollars (e.g., "0.56")',
    },
    noPriceDollars: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated no price in dollars (e.g., "0.56")',
    },
    countFp: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Count in fixed-point for fractional contracts',
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
      }

      if (params.clientOrderId) body.client_order_id = params.clientOrderId
      if (params.updatedClientOrderId) body.updated_client_order_id = params.updatedClientOrderId
      if (params.count) body.count = Number.parseInt(params.count, 10)
      if (params.yesPrice) body.yes_price = Number.parseInt(params.yesPrice, 10)
      if (params.noPrice) body.no_price = Number.parseInt(params.noPrice, 10)
      if (params.yesPriceDollars) body.yes_price_dollars = params.yesPriceDollars
      if (params.noPriceDollars) body.no_price_dollars = params.noPriceDollars
      if (params.countFp) body.count_fp = params.countFp

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handleKalshiError(data, response.status, 'amend_order_v2')
    }

    const mapOrder = (order: any): KalshiAmendOrderV2Order => ({
      order_id: order.order_id ?? null,
      user_id: order.user_id ?? null,
      ticker: order.ticker ?? null,
      event_ticker: order.event_ticker ?? null,
      status: order.status ?? null,
      side: order.side ?? null,
      type: order.type ?? null,
      yes_price: order.yes_price ?? null,
      no_price: order.no_price ?? null,
      action: order.action ?? null,
      count: order.count ?? null,
      remaining_count: order.remaining_count ?? null,
      created_time: order.created_time ?? null,
      expiration_time: order.expiration_time ?? null,
      order_group_id: order.order_group_id ?? null,
      client_order_id: order.client_order_id ?? null,
      place_count: order.place_count ?? null,
      decrease_count: order.decrease_count ?? null,
      queue_position: order.queue_position ?? null,
      maker_fill_count: order.maker_fill_count ?? null,
      taker_fill_count: order.taker_fill_count ?? null,
      maker_fees: order.maker_fees ?? null,
      taker_fees: order.taker_fees ?? null,
      last_update_time: order.last_update_time ?? null,
      take_profit_order_id: order.take_profit_order_id ?? null,
      stop_loss_order_id: order.stop_loss_order_id ?? null,
      amend_count: order.amend_count ?? null,
      amend_taker_fill_count: order.amend_taker_fill_count ?? null,
    })

    return {
      success: true,
      output: {
        old_order: mapOrder(data.old_order || {}),
        order: mapOrder(data.order || {}),
      },
    }
  },

  outputs: {
    old_order: {
      type: 'object',
      description: 'The original order object before amendment',
      properties: {
        order_id: { type: 'string', description: 'Order ID' },
        user_id: { type: 'string', description: 'User ID' },
        ticker: { type: 'string', description: 'Market ticker' },
        event_ticker: { type: 'string', description: 'Event ticker' },
        status: { type: 'string', description: 'Order status' },
        side: { type: 'string', description: 'Order side (yes/no)' },
        type: { type: 'string', description: 'Order type (limit/market)' },
        yes_price: { type: 'number', description: 'Yes price in cents' },
        no_price: { type: 'number', description: 'No price in cents' },
        action: { type: 'string', description: 'Action (buy/sell)' },
        count: { type: 'number', description: 'Number of contracts' },
        remaining_count: { type: 'number', description: 'Remaining contracts' },
        created_time: { type: 'string', description: 'Order creation time' },
        expiration_time: { type: 'string', description: 'Order expiration time' },
        order_group_id: { type: 'string', description: 'Order group ID' },
        client_order_id: { type: 'string', description: 'Client order ID' },
        place_count: { type: 'number', description: 'Place count' },
        decrease_count: { type: 'number', description: 'Decrease count' },
        queue_position: { type: 'number', description: 'Queue position' },
        maker_fill_count: { type: 'number', description: 'Maker fill count' },
        taker_fill_count: { type: 'number', description: 'Taker fill count' },
        maker_fees: { type: 'number', description: 'Maker fees' },
        taker_fees: { type: 'number', description: 'Taker fees' },
        last_update_time: { type: 'string', description: 'Last update time' },
        take_profit_order_id: { type: 'string', description: 'Take profit order ID' },
        stop_loss_order_id: { type: 'string', description: 'Stop loss order ID' },
        amend_count: { type: 'number', description: 'Amend count' },
        amend_taker_fill_count: { type: 'number', description: 'Amend taker fill count' },
      },
    },
    order: {
      type: 'object',
      description: 'The amended order object with full API response fields',
      properties: {
        order_id: { type: 'string', description: 'Order ID' },
        user_id: { type: 'string', description: 'User ID' },
        ticker: { type: 'string', description: 'Market ticker' },
        event_ticker: { type: 'string', description: 'Event ticker' },
        status: { type: 'string', description: 'Order status' },
        side: { type: 'string', description: 'Order side (yes/no)' },
        type: { type: 'string', description: 'Order type (limit/market)' },
        yes_price: { type: 'number', description: 'Yes price in cents' },
        no_price: { type: 'number', description: 'No price in cents' },
        action: { type: 'string', description: 'Action (buy/sell)' },
        count: { type: 'number', description: 'Number of contracts' },
        remaining_count: { type: 'number', description: 'Remaining contracts' },
        created_time: { type: 'string', description: 'Order creation time' },
        expiration_time: { type: 'string', description: 'Order expiration time' },
        order_group_id: { type: 'string', description: 'Order group ID' },
        client_order_id: { type: 'string', description: 'Client order ID' },
        place_count: { type: 'number', description: 'Place count' },
        decrease_count: { type: 'number', description: 'Decrease count' },
        queue_position: { type: 'number', description: 'Queue position' },
        maker_fill_count: { type: 'number', description: 'Maker fill count' },
        taker_fill_count: { type: 'number', description: 'Taker fill count' },
        maker_fees: { type: 'number', description: 'Maker fees' },
        taker_fees: { type: 'number', description: 'Taker fees' },
        last_update_time: { type: 'string', description: 'Last update time' },
        take_profit_order_id: { type: 'string', description: 'Take profit order ID' },
        stop_loss_order_id: { type: 'string', description: 'Stop loss order ID' },
        amend_count: { type: 'number', description: 'Amend count' },
        amend_taker_fill_count: { type: 'number', description: 'Amend taker fill count' },
      },
    },
  },
}
