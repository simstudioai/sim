import {
  buildKalshiCreateOrderBody,
  kalshiCountNumber,
  kalshiLegacyOrder,
  kalshiOrderPath,
  kalshiWrittenOrder,
} from '@/tools/kalshi/orders'
import type { KalshiAuthParams } from '@/tools/kalshi/types'
import { buildKalshiAuthHeaders, buildKalshiUrl, handleKalshiError } from '@/tools/kalshi/types'
import { KALSHI_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
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
    order: Record<string, unknown>
  }
}

/** What a V2 create reports about the order, under the legacy order field names. */
type KalshiCreatedOrder = Omit<ReturnType<typeof kalshiWrittenOrder>, 'processed_time'> & {
  created_time: string | null
}

/** Maps Kalshi's CreateOrderV2Response onto the order this create sent. */
function createdOrder(
  data: unknown,
  params: KalshiCreateOrderParams | KalshiCreateOrderV2Params
): KalshiCreatedOrder {
  const { processed_time, ...order } = kalshiWrittenOrder(
    data,
    params,
    buildKalshiCreateOrderBody(params)
  )
  return { ...order, created_time: processed_time }
}

const ORDERS_PATH = kalshiOrderPath()

export const kalshiCreateOrderTool: ToolConfig<KalshiCreateOrderParams, KalshiCreateOrderResponse> =
  {
    id: 'kalshi_create_order',
    name: 'Create Order on Kalshi',
    description: 'Create a new order on a Kalshi prediction market',
    version: '1.0.0',
    oauth: KALSHI_CREDENTIAL_OAUTH,

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
        description:
          'Order type: "limit" (default). Kalshi no longer accepts "market" orders; set a price instead',
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
        description:
          "Time in force: 'good_till_canceled' (default), 'fill_or_kill', or 'immediate_or_cancel'",
      },
      buyMaxCost: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'No longer supported by Kalshi: set a limit price and count with timeInForce fill_or_kill instead',
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
        description: "Self-trade prevention: 'taker_at_cross' (default) or 'maker'",
      },
      orderGroupId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Associated order group ID',
      },
    },

    request: {
      url: () => buildKalshiUrl(ORDERS_PATH),
      method: 'POST',
      headers: (params) =>
        buildKalshiAuthHeaders(
          params.keyId,
          params.privateKey,
          'POST',
          `/trade-api/v2${ORDERS_PATH}`
        ),
      body: (params) => buildKalshiCreateOrderBody(params),
    },

    transformResponse: async (response: Response, params) => {
      const data = await response.json()

      if (!response.ok) {
        handleKalshiError(data, 'create_order')
      }
      if (!params) throw new Error('Kalshi create_order needs its params to read the response')

      return {
        success: true,
        output: {
          order: kalshiLegacyOrder({
            ...createdOrder(data, params),
            count: kalshiCountNumber(buildKalshiCreateOrderBody(params).count),
          }),
        },
      }
    },

    outputs: {
      order: {
        type: 'object',
        description:
          'The created order: order_id, client_order_id and fill counts from Kalshi, with the direction, price and settings this request sent',
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
      order_id: string | null
      user_id: string | null
      client_order_id: string | null
      ticker: string | null
      side: string | null
      action: string | null
      type: string | null
      status: string | null
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
  description: 'Create a new order on a Kalshi prediction market',
  version: '2.0.0',
  oauth: KALSHI_CREDENTIAL_OAUTH,

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
      description:
        'Order type: "limit" (default). Kalshi no longer accepts "market" orders; set a price instead',
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
      description:
        "Time in force: 'good_till_canceled' (default), 'fill_or_kill', or 'immediate_or_cancel'",
    },
    buyMaxCost: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'No longer supported by Kalshi: set a limit price and count with timeInForce fill_or_kill instead',
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
      description: "Self-trade prevention: 'taker_at_cross' (default) or 'maker'",
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
    url: () => buildKalshiUrl(ORDERS_PATH),
    method: 'POST',
    headers: (params) =>
      buildKalshiAuthHeaders(
        params.keyId,
        params.privateKey,
        'POST',
        `/trade-api/v2${ORDERS_PATH}`
      ),
    body: (params) => buildKalshiCreateOrderBody(params),
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json()

    if (!response.ok) {
      handleKalshiError(data, 'create_order_v2')
    }
    if (!params) throw new Error('Kalshi create_order_v2 needs its params to read the response')

    const order = createdOrder(data, params)

    // Kalshi's V2 create returns only the order's identity and fill counts; fields it no longer
    // reports on a write are null.
    return {
      success: true,
      output: {
        order: {
          order_id: order.order_id,
          user_id: null,
          client_order_id: order.client_order_id,
          ticker: order.ticker,
          side: order.side,
          action: order.action,
          type: order.type,
          status: null,
          yes_price: null,
          no_price: null,
          yes_price_dollars: order.yes_price_dollars,
          no_price_dollars: order.no_price_dollars,
          fill_count: order.fill_count,
          fill_count_fp: order.fill_count_fp,
          remaining_count: order.remaining_count,
          remaining_count_fp: order.remaining_count_fp,
          initial_count: kalshiCountNumber(order.initial_count_fp),
          initial_count_fp: order.initial_count_fp,
          taker_fees: null,
          maker_fees: null,
          taker_fees_dollars: null,
          maker_fees_dollars: null,
          taker_fill_cost: null,
          maker_fill_cost: null,
          taker_fill_cost_dollars: null,
          maker_fill_cost_dollars: null,
          queue_position: null,
          expiration_time: null,
          created_time: order.created_time,
          last_update_time: null,
          self_trade_prevention_type: order.self_trade_prevention_type,
          order_group_id: order.order_group_id,
          cancel_order_on_pause: order.cancel_order_on_pause,
        },
      },
    }
  },

  outputs: {
    order: {
      type: 'object',
      description:
        'The created order. Kalshi reports only its ID and fill counts on create; the direction, price and settings are the ones this request sent, and fields Kalshi no longer reports are null',
      properties: {
        order_id: { type: 'string', description: 'Order ID', nullable: true },
        user_id: { type: 'string', description: 'User ID', nullable: true },
        client_order_id: { type: 'string', description: 'Client order ID', nullable: true },
        ticker: { type: 'string', description: 'Market ticker', nullable: true },
        side: { type: 'string', description: 'Order side (yes/no)', nullable: true },
        action: { type: 'string', description: 'Action (buy/sell)', nullable: true },
        type: { type: 'string', description: 'Order type (limit/market)', nullable: true },
        status: {
          type: 'string',
          description: 'Order status (resting/canceled/executed)',
          nullable: true,
        },
        yes_price: { type: 'number', description: 'Yes price in cents', nullable: true },
        no_price: { type: 'number', description: 'No price in cents', nullable: true },
        yes_price_dollars: { type: 'string', description: 'Yes price in dollars', nullable: true },
        no_price_dollars: { type: 'string', description: 'No price in dollars', nullable: true },
        fill_count: { type: 'number', description: 'Filled contract count', nullable: true },
        fill_count_fp: {
          type: 'string',
          description: 'Filled count (fixed-point)',
          nullable: true,
        },
        remaining_count: { type: 'number', description: 'Remaining contracts', nullable: true },
        remaining_count_fp: {
          type: 'string',
          description: 'Remaining count (fixed-point)',
          nullable: true,
        },
        initial_count: { type: 'number', description: 'Initial contract count', nullable: true },
        initial_count_fp: {
          type: 'string',
          description: 'Initial count (fixed-point)',
          nullable: true,
        },
        taker_fees: { type: 'number', description: 'Taker fees in cents', nullable: true },
        maker_fees: { type: 'number', description: 'Maker fees in cents', nullable: true },
        taker_fees_dollars: {
          type: 'string',
          description: 'Taker fees in dollars',
          nullable: true,
        },
        maker_fees_dollars: {
          type: 'string',
          description: 'Maker fees in dollars',
          nullable: true,
        },
        taker_fill_cost: {
          type: 'number',
          description: 'Taker fill cost in cents',
          nullable: true,
        },
        maker_fill_cost: {
          type: 'number',
          description: 'Maker fill cost in cents',
          nullable: true,
        },
        taker_fill_cost_dollars: {
          type: 'string',
          description: 'Taker fill cost in dollars',
          nullable: true,
        },
        maker_fill_cost_dollars: {
          type: 'string',
          description: 'Maker fill cost in dollars',
          nullable: true,
        },
        queue_position: {
          type: 'number',
          description: 'Queue position (deprecated)',
          nullable: true,
        },
        expiration_time: { type: 'string', description: 'Order expiration time', nullable: true },
        created_time: { type: 'string', description: 'Order creation time', nullable: true },
        last_update_time: { type: 'string', description: 'Last update time', nullable: true },
        self_trade_prevention_type: {
          type: 'string',
          description: 'Self-trade prevention type',
          nullable: true,
        },
        order_group_id: { type: 'string', description: 'Order group ID', nullable: true },
        cancel_order_on_pause: {
          type: 'boolean',
          description: 'Cancel on market pause',
          nullable: true,
        },
      },
    },
  },
}
