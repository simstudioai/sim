import { getErrorMessage } from '@sim/utils/errors'
import { toRecord } from '@sim/utils/object'
import {
  buildKalshiAmendOrderBody,
  KALSHI_ORDER_SUBACCOUNT_PARAM,
  type KalshiLegacyOrderParams,
  kalshiAmendNeedsCurrentOrder,
  kalshiAmendParamsFromOrder,
  kalshiCountNumber,
  kalshiLegacyOrder,
  kalshiOrderPath,
  kalshiOrderReadPath,
  kalshiOrderWriteUrl,
  kalshiWrittenOrder,
} from '@/tools/kalshi/orders'
import type { KalshiAuthParams } from '@/tools/kalshi/types'
import { buildKalshiAuthHeaders, buildKalshiUrl, handleKalshiError } from '@/tools/kalshi/types'
import { KALSHI_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { ToolConfig, ToolResponse } from '@/tools/types'

/**
 * An amend with no count or no price first reads the order (`GET /portfolio/orders/{id}`), since
 * Kalshi's V2 amend requires both; `postProcess` then sends the amend with the order's current
 * total and price filled in. The signed path is always the path requested.
 */
function amendRequestPath(
  params: KalshiAuthParams & KalshiLegacyOrderParams & { orderId: string }
) {
  return kalshiAmendNeedsCurrentOrder(params)
    ? kalshiOrderReadPath(params.orderId)
    : kalshiOrderPath(params.orderId, 'amend')
}

/** The read takes no subaccount (GetOrder has no such param); the amend does. */
function amendRequestUrl(
  params: KalshiAuthParams & KalshiLegacyOrderParams & { orderId: string }
): string {
  const path = amendRequestPath(params)
  return kalshiAmendNeedsCurrentOrder(params)
    ? buildKalshiUrl(path)
    : kalshiOrderWriteUrl(path, params.subaccount)
}

function amendRequestMethod(params: KalshiLegacyOrderParams): 'GET' | 'POST' {
  return kalshiAmendNeedsCurrentOrder(params) ? 'GET' : 'POST'
}

/** The legacy order fields a V2 amend reports, under their legacy names. */
function amendedOrder(data: unknown, params: KalshiLegacyOrderParams) {
  const { processed_time, initial_count_fp, ...order } = kalshiWrittenOrder(
    data,
    params,
    buildKalshiAmendOrderBody(params)
  )
  return { ...order, count: kalshiCountNumber(initial_count_fp), last_update_time: processed_time }
}

/** Sends the amend once the order read filled in its count and price. */
async function amendWithCurrentOrder(
  toolId: string,
  params: KalshiLegacyOrderParams,
  currentOrder: unknown,
  executeTool: (toolId: string, params: Record<string, unknown>) => Promise<ToolResponse>
): Promise<ToolResponse> {
  let next: KalshiLegacyOrderParams
  try {
    next = kalshiAmendParamsFromOrder(params, currentOrder)
  } catch (error) {
    return {
      success: false,
      output: {},
      error: `Could not read the order's current count and price to amend it: ${getErrorMessage(error)}`,
    }
  }
  try {
    return await executeTool(toolId, { ...params, ...next })
  } catch (error) {
    return {
      success: false,
      output: {},
      error: `Could not amend the order: ${getErrorMessage(error)}`,
    }
  }
}

export interface KalshiAmendOrderParams extends KalshiAuthParams {
  orderId: string // Order ID to amend (required)
  ticker: string // Market ticker (required)
  side: string // 'yes' or 'no' (required)
  action: string // 'buy' or 'sell' (required)
  clientOrderId?: string // Original client order ID
  updatedClientOrderId?: string // New client order ID
  count?: string // New total contracts (filled + resting)
  yesPrice?: string // Updated yes price in cents (1-99)
  noPrice?: string // Updated no price in cents (1-99)
  yesPriceDollars?: string // Updated yes price in dollars
  noPriceDollars?: string // Updated no price in dollars
  subaccount?: string // Subaccount the order belongs to
}

export interface KalshiAmendOrderResponse {
  success: boolean
  error?: string
  output: {
    order: Record<string, unknown>
  }
}

export const kalshiAmendOrderTool: ToolConfig<KalshiAmendOrderParams, KalshiAmendOrderResponse> = {
  id: 'kalshi_amend_order',
  name: 'Amend Order on Kalshi',
  description: 'Modify the price or quantity of an existing order on Kalshi',
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
      description:
        'New total contracts for the order: already filled plus desired resting (e.g., "10"). Leave empty to keep the current total, only if the order hasn\'t just changed; Kalshi\'s order reads can briefly lag',
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
    subaccount: KALSHI_ORDER_SUBACCOUNT_PARAM,
  },

  request: {
    url: (params) => amendRequestUrl(params),
    method: (params) => amendRequestMethod(params),
    headers: (params) =>
      buildKalshiAuthHeaders(
        params.keyId,
        params.privateKey,
        amendRequestMethod(params),
        `/trade-api/v2${amendRequestPath(params)}`
      ),
    body: (params) =>
      kalshiAmendNeedsCurrentOrder(params) ? undefined : buildKalshiAmendOrderBody(params),
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json()

    if (!response.ok) {
      handleKalshiError(data, 'amend_order')
    }
    if (!params) throw new Error('Kalshi amend_order needs its params to read the response')

    // The order read that precedes an amend with no count or price: postProcess uses it.
    if (kalshiAmendNeedsCurrentOrder(params)) {
      return { success: true, output: { order: toRecord(data.order) } }
    }

    return {
      success: true,
      output: {
        order: kalshiLegacyOrder(amendedOrder(data, params)),
      },
    }
  },

  postProcess: async (result, params, executeTool) => {
    if (!result.success || !kalshiAmendNeedsCurrentOrder(params)) return result
    return amendWithCurrentOrder(
      'kalshi_amend_order',
      params,
      result.output.order,
      executeTool
    ) as Promise<typeof result>
  },

  outputs: {
    order: {
      type: 'object',
      description:
        'The amended order: order_id, client_order_id and counts from Kalshi, with the direction, price and total count this amend sent',
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
  count?: string // New total contracts (filled + resting)
  yesPrice?: string // Updated yes price in cents (1-99)
  noPrice?: string // Updated no price in cents (1-99)
  yesPriceDollars?: string // Updated yes price in dollars
  noPriceDollars?: string // Updated no price in dollars
  countFp?: string // Count in fixed-point for fractional contracts
  subaccount?: string // Subaccount the order belongs to
}

interface KalshiAmendOrderV2Order {
  order_id: string | null
  user_id: string | null
  ticker: string | null
  event_ticker: string | null
  status: string | null
  side: string | null
  type: string | null
  yes_price: number | null
  no_price: number | null
  yes_price_dollars: string | null
  no_price_dollars: string | null
  action: string | null
  count: number | null
  remaining_count: number | null
  fill_count_fp: string | null
  remaining_count_fp: string | null
  created_time: string | null
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

/** A V2 amend order output from an order record, with every unreported field null. */
function mapOrder(order: Record<string, unknown>): KalshiAmendOrderV2Order {
  const read = <T>(key: string) => (order[key] ?? null) as T | null
  return {
    order_id: read('order_id'),
    user_id: read('user_id'),
    ticker: read('ticker'),
    event_ticker: read('event_ticker'),
    status: read('status'),
    side: read('side'),
    type: read('type'),
    yes_price: read('yes_price'),
    no_price: read('no_price'),
    yes_price_dollars: read('yes_price_dollars'),
    no_price_dollars: read('no_price_dollars'),
    action: read('action'),
    count: read('count'),
    remaining_count: read('remaining_count'),
    fill_count_fp: read('fill_count_fp'),
    remaining_count_fp: read('remaining_count_fp'),
    created_time: read('created_time'),
    expiration_time: read('expiration_time'),
    order_group_id: read('order_group_id'),
    client_order_id: read('client_order_id'),
    place_count: read('place_count'),
    decrease_count: read('decrease_count'),
    queue_position: read('queue_position'),
    maker_fill_count: read('maker_fill_count'),
    taker_fill_count: read('taker_fill_count'),
    maker_fees: read('maker_fees'),
    taker_fees: read('taker_fees'),
    last_update_time: read('last_update_time'),
    take_profit_order_id: read('take_profit_order_id'),
    stop_loss_order_id: read('stop_loss_order_id'),
    amend_count: read('amend_count'),
    amend_taker_fill_count: read('amend_taker_fill_count'),
  }
}

export interface KalshiAmendOrderV2Response {
  success: boolean
  error?: string
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
  description: 'Modify the price or quantity of an existing order on Kalshi',
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
      description:
        'New total contracts for the order: already filled plus desired resting (e.g., "10"). Leave empty to keep the current total, only if the order hasn\'t just changed; Kalshi\'s order reads can briefly lag',
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
    subaccount: KALSHI_ORDER_SUBACCOUNT_PARAM,
  },

  request: {
    url: (params) => amendRequestUrl(params),
    method: (params) => amendRequestMethod(params),
    headers: (params) =>
      buildKalshiAuthHeaders(
        params.keyId,
        params.privateKey,
        amendRequestMethod(params),
        `/trade-api/v2${amendRequestPath(params)}`
      ),
    body: (params) =>
      kalshiAmendNeedsCurrentOrder(params) ? undefined : buildKalshiAmendOrderBody(params),
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json()

    if (!response.ok) {
      handleKalshiError(data, 'amend_order_v2')
    }
    if (!params) throw new Error('Kalshi amend_order_v2 needs its params to read the response')

    // The order read that precedes an amend with no count or price: postProcess uses it.
    if (kalshiAmendNeedsCurrentOrder(params)) {
      return {
        success: true,
        output: { old_order: mapOrder(toRecord(data.order)), order: mapOrder({}) },
      }
    }

    const order = amendedOrder(data, params)
    return {
      success: true,
      output: {
        old_order: mapOrder({ order_id: order.order_id }),
        order: mapOrder(order),
      },
    }
  },

  postProcess: async (result, params, executeTool) => {
    if (!result.success || !kalshiAmendNeedsCurrentOrder(params)) return result
    const amended = await amendWithCurrentOrder(
      'kalshi_amend_order_v2',
      params,
      result.output.old_order,
      executeTool
    )
    if (!amended.success) return amended as typeof result
    return {
      ...amended,
      output: { ...amended.output, old_order: result.output.old_order },
    } as typeof result
  },

  outputs: {
    old_order: {
      type: 'object',
      description:
        'The order before the amend when it was read first (an amend with no count or price); otherwise only order_id is known',
      properties: {
        order_id: { type: 'string', description: 'Order ID', nullable: true },
        user_id: { type: 'string', description: 'User ID', nullable: true },
        ticker: { type: 'string', description: 'Market ticker', nullable: true },
        event_ticker: { type: 'string', description: 'Event ticker', nullable: true },
        status: { type: 'string', description: 'Order status', nullable: true },
        side: { type: 'string', description: 'Order side (yes/no)', nullable: true },
        type: { type: 'string', description: 'Order type (limit/market)', nullable: true },
        yes_price: { type: 'number', description: 'Yes price in cents', nullable: true },
        no_price: { type: 'number', description: 'No price in cents', nullable: true },
        yes_price_dollars: { type: 'string', description: 'Yes price in dollars', nullable: true },
        no_price_dollars: { type: 'string', description: 'No price in dollars', nullable: true },
        action: { type: 'string', description: 'Action (buy/sell)', nullable: true },
        count: { type: 'number', description: 'Number of contracts', nullable: true },
        remaining_count: { type: 'number', description: 'Remaining contracts', nullable: true },
        fill_count_fp: {
          type: 'string',
          description: 'Filled count (fixed-point)',
          nullable: true,
        },
        remaining_count_fp: {
          type: 'string',
          description: 'Remaining count (fixed-point)',
          nullable: true,
        },
        created_time: { type: 'string', description: 'Order creation time', nullable: true },
        expiration_time: { type: 'string', description: 'Order expiration time', nullable: true },
        order_group_id: { type: 'string', description: 'Order group ID', nullable: true },
        client_order_id: { type: 'string', description: 'Client order ID', nullable: true },
        place_count: { type: 'number', description: 'Place count', nullable: true },
        decrease_count: { type: 'number', description: 'Decrease count', nullable: true },
        queue_position: { type: 'number', description: 'Queue position', nullable: true },
        maker_fill_count: { type: 'number', description: 'Maker fill count', nullable: true },
        taker_fill_count: { type: 'number', description: 'Taker fill count', nullable: true },
        maker_fees: { type: 'number', description: 'Maker fees', nullable: true },
        taker_fees: { type: 'number', description: 'Taker fees', nullable: true },
        last_update_time: { type: 'string', description: 'Last update time', nullable: true },
        take_profit_order_id: {
          type: 'string',
          description: 'Take profit order ID',
          nullable: true,
        },
        stop_loss_order_id: { type: 'string', description: 'Stop loss order ID', nullable: true },
        amend_count: { type: 'number', description: 'Amend count', nullable: true },
        amend_taker_fill_count: {
          type: 'number',
          description: 'Amend taker fill count',
          nullable: true,
        },
      },
    },
    order: {
      type: 'object',
      description:
        'The amended order: order_id, client_order_id and counts from Kalshi, with the direction, price and total count this amend sent; fields Kalshi no longer reports are null',
      properties: {
        order_id: { type: 'string', description: 'Order ID', nullable: true },
        user_id: { type: 'string', description: 'User ID', nullable: true },
        ticker: { type: 'string', description: 'Market ticker', nullable: true },
        event_ticker: { type: 'string', description: 'Event ticker', nullable: true },
        status: { type: 'string', description: 'Order status', nullable: true },
        side: { type: 'string', description: 'Order side (yes/no)', nullable: true },
        type: { type: 'string', description: 'Order type (limit/market)', nullable: true },
        yes_price: { type: 'number', description: 'Yes price in cents', nullable: true },
        no_price: { type: 'number', description: 'No price in cents', nullable: true },
        yes_price_dollars: { type: 'string', description: 'Yes price in dollars', nullable: true },
        no_price_dollars: { type: 'string', description: 'No price in dollars', nullable: true },
        action: { type: 'string', description: 'Action (buy/sell)', nullable: true },
        count: { type: 'number', description: 'Number of contracts', nullable: true },
        remaining_count: { type: 'number', description: 'Remaining contracts', nullable: true },
        fill_count_fp: {
          type: 'string',
          description: 'Contracts filled by this amend (fixed-point)',
          nullable: true,
        },
        remaining_count_fp: {
          type: 'string',
          description: 'Remaining count (fixed-point)',
          nullable: true,
        },
        created_time: { type: 'string', description: 'Order creation time', nullable: true },
        expiration_time: { type: 'string', description: 'Order expiration time', nullable: true },
        order_group_id: { type: 'string', description: 'Order group ID', nullable: true },
        client_order_id: { type: 'string', description: 'Client order ID', nullable: true },
        place_count: { type: 'number', description: 'Place count', nullable: true },
        decrease_count: { type: 'number', description: 'Decrease count', nullable: true },
        queue_position: { type: 'number', description: 'Queue position', nullable: true },
        maker_fill_count: { type: 'number', description: 'Maker fill count', nullable: true },
        taker_fill_count: { type: 'number', description: 'Taker fill count', nullable: true },
        maker_fees: { type: 'number', description: 'Maker fees', nullable: true },
        taker_fees: { type: 'number', description: 'Taker fees', nullable: true },
        last_update_time: { type: 'string', description: 'Last update time', nullable: true },
        take_profit_order_id: {
          type: 'string',
          description: 'Take profit order ID',
          nullable: true,
        },
        stop_loss_order_id: { type: 'string', description: 'Stop loss order ID', nullable: true },
        amend_count: { type: 'number', description: 'Amend count', nullable: true },
        amend_taker_fill_count: {
          type: 'number',
          description: 'Amend taker fill count',
          nullable: true,
        },
      },
    },
  },
}
