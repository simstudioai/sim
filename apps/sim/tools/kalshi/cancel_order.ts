import { getErrorMessage } from '@sim/utils/errors'
import { toRecord } from '@sim/utils/object'
import {
  KALSHI_ORDER_SUBACCOUNT_PARAM,
  kalshiCountNumber,
  kalshiLegacyOrder,
  kalshiOrderPath,
  kalshiOrderReadPath,
  kalshiOrderWriteUrl,
} from '@/tools/kalshi/orders'
import type { KalshiAuthParams } from '@/tools/kalshi/types'
import { buildKalshiAuthHeaders, buildKalshiUrl, handleKalshiError } from '@/tools/kalshi/types'
import { KALSHI_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { ToolConfig, ToolResponse } from '@/tools/types'

/**
 * Cancel Order (V2) routes by `market_ticker`: without it Kalshi sends the cancel to shard 0, and
 * an order resting on another shard answers 404 and stays open (Kalshi's order_errors guide). With
 * no ticker given, the tool first reads the order (`GET /portfolio/orders/{id}`, which needs no
 * routing) and `postProcess` sends the cancel with the order's ticker.
 */
function cancelNeedsTicker(params: { ticker?: string }): boolean {
  return params.ticker == null || String(params.ticker).trim() === ''
}

function cancelRequestPath(params: { orderId: string; ticker?: string }): string {
  return cancelNeedsTicker(params)
    ? kalshiOrderReadPath(params.orderId)
    : kalshiOrderPath(params.orderId)
}

/** The read takes no subaccount (GetOrder has no such param); the cancel does. */
function cancelRequestUrl(params: {
  orderId: string
  ticker?: string
  subaccount?: string
}): string {
  if (cancelNeedsTicker(params)) return buildKalshiUrl(cancelRequestPath(params))
  return kalshiOrderWriteUrl(cancelRequestPath(params), params.subaccount, {
    market_ticker: String(params.ticker).trim(),
  })
}

function cancelRequestMethod(params: { ticker?: string }): 'GET' | 'DELETE' {
  return cancelNeedsTicker(params) ? 'GET' : 'DELETE'
}

/** The ticker of the order a cancel's read returned (GetOrderResponse `order`). */
function readOrderTicker(data: unknown): string | null {
  const ticker = toRecord(toRecord(data).order).ticker
  return typeof ticker === 'string' && ticker.trim() ? ticker : null
}

/** Sends the cancel once the order read found the order's ticker. */
async function cancelWithOrderTicker(
  toolId: string,
  params: Record<string, unknown>,
  ticker: unknown,
  executeTool: (toolId: string, params: Record<string, unknown>) => Promise<ToolResponse>
): Promise<ToolResponse> {
  if (typeof ticker !== 'string' || !ticker) {
    return {
      success: false,
      output: {},
      error: "Could not cancel the order: Kalshi's order read returned no market ticker",
    }
  }
  try {
    return await executeTool(toolId, { ...params, ticker })
  } catch (error) {
    return {
      success: false,
      output: {},
      error: `Could not cancel the order: ${getErrorMessage(error)}`,
    }
  }
}

const TICKER_PARAM = {
  type: 'string',
  required: false,
  visibility: 'user-or-llm',
  description:
    'Market ticker of the order (e.g., "KXBTC-24DEC31"), so the cancel reaches the order\'s exchange shard. Leave empty to look it up from the order first',
} as const

export interface KalshiCancelOrderParams extends KalshiAuthParams {
  orderId: string // Order ID to cancel (required)
  ticker?: string // Market ticker, which routes the cancel to the order's shard
  subaccount?: string // Subaccount the order belongs to
}

export interface KalshiCancelOrderResponse {
  success: boolean
  error?: string
  output: {
    order: Record<string, unknown>
    reducedBy: number
  }
}

export const kalshiCancelOrderTool: ToolConfig<KalshiCancelOrderParams, KalshiCancelOrderResponse> =
  {
    id: 'kalshi_cancel_order',
    name: 'Cancel Order on Kalshi',
    description: 'Cancel an existing order on Kalshi',
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
        description: 'Order ID to cancel (e.g., "abc123-def456-ghi789")',
      },
      ticker: TICKER_PARAM,
      subaccount: KALSHI_ORDER_SUBACCOUNT_PARAM,
    },

    request: {
      url: (params) => cancelRequestUrl(params),
      method: (params) => cancelRequestMethod(params),
      headers: (params) =>
        buildKalshiAuthHeaders(
          params.keyId,
          params.privateKey,
          cancelRequestMethod(params),
          `/trade-api/v2${cancelRequestPath(params)}`
        ),
    },

    transformResponse: async (response: Response, params) => {
      const data = await response.json()

      if (!response.ok) {
        handleKalshiError(data, params && cancelNeedsTicker(params) ? 'order read' : 'cancel_order')
      }

      // The order read that precedes a cancel with no ticker: postProcess cancels with its ticker.
      if (params && cancelNeedsTicker(params)) {
        return {
          success: true,
          output: {
            order: kalshiLegacyOrder({
              order_id: params.orderId,
              client_order_id: null,
              ticker: readOrderTicker(data),
            }),
            reducedBy: 0,
          },
        }
      }

      // V2 returns only the order's identity, not the full order object.
      return {
        success: true,
        output: {
          order: kalshiLegacyOrder({
            order_id: data.order_id ?? null,
            client_order_id: data.client_order_id ?? null,
            ticker: params?.ticker?.trim() || null,
          }),
          reducedBy: kalshiCountNumber(data.reduced_by) ?? 0,
        },
      }
    },

    postProcess: async (result, params, executeTool) => {
      if (!result.success || !cancelNeedsTicker(params)) return result
      return cancelWithOrderTicker(
        'kalshi_cancel_order',
        { ...params },
        result.output.order.ticker,
        executeTool
      ) as Promise<typeof result>
    },

    outputs: {
      order: {
        type: 'object',
        description:
          'The canceled order: order_id, client_order_id and ticker (Kalshi no longer returns the full order on cancel)',
      },
      reducedBy: {
        type: 'number',
        description: 'Number of contracts canceled',
      },
    },
  }

export interface KalshiCancelOrderV2Params extends KalshiAuthParams {
  orderId: string // Order ID to cancel (required)
  ticker?: string // Market ticker, which routes the cancel to the order's shard
  subaccount?: string // Subaccount the order belongs to
}

export interface KalshiCancelOrderV2Response {
  success: boolean
  error?: string
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
    reduced_by: number
    reduced_by_fp: string | null
  }
}

export const kalshiCancelOrderV2Tool: ToolConfig<
  KalshiCancelOrderV2Params,
  KalshiCancelOrderV2Response
> = {
  id: 'kalshi_cancel_order_v2',
  name: 'Cancel Order on Kalshi V2',
  description: 'Cancel an existing order on Kalshi',
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
      description: 'Order ID to cancel (e.g., "abc123-def456-ghi789")',
    },
    ticker: TICKER_PARAM,
    subaccount: KALSHI_ORDER_SUBACCOUNT_PARAM,
  },

  request: {
    url: (params) => cancelRequestUrl(params),
    method: (params) => cancelRequestMethod(params),
    headers: (params) =>
      buildKalshiAuthHeaders(
        params.keyId,
        params.privateKey,
        cancelRequestMethod(params),
        `/trade-api/v2${cancelRequestPath(params)}`
      ),
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json()

    if (!response.ok) {
      handleKalshiError(
        data,
        params && cancelNeedsTicker(params) ? 'order read' : 'cancel_order_v2'
      )
    }

    // The order read that precedes a cancel with no ticker: postProcess cancels with its ticker.
    const isRead = Boolean(params && cancelNeedsTicker(params))
    const ticker = isRead ? readOrderTicker(data) : params?.ticker?.trim() || null

    // V2 returns only the order's identity, so the other order fields are unknown here.
    return {
      success: true,
      output: {
        order: {
          order_id: isRead ? (params?.orderId ?? null) : (data.order_id ?? null),
          user_id: null,
          client_order_id: isRead ? null : (data.client_order_id ?? null),
          ticker,
          side: null,
          action: null,
          type: null,
          status: null,
          yes_price: null,
          no_price: null,
          yes_price_dollars: null,
          no_price_dollars: null,
          fill_count: null,
          fill_count_fp: null,
          remaining_count: null,
          remaining_count_fp: null,
          initial_count: null,
          initial_count_fp: null,
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
          created_time: null,
          last_update_time: null,
          self_trade_prevention_type: null,
          order_group_id: null,
          cancel_order_on_pause: null,
        },
        reduced_by: isRead ? 0 : (kalshiCountNumber(data.reduced_by) ?? 0),
        reduced_by_fp: !isRead && typeof data.reduced_by === 'string' ? data.reduced_by : null,
      },
    }
  },

  postProcess: async (result, params, executeTool) => {
    if (!result.success || !cancelNeedsTicker(params)) return result
    return cancelWithOrderTicker(
      'kalshi_cancel_order_v2',
      { ...params },
      result.output.order.ticker,
      executeTool
    ) as Promise<typeof result>
  },
  outputs: {
    order: {
      type: 'object',
      description:
        'The canceled order. Kalshi now returns only order_id and client_order_id on cancel, so the other fields are null',
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
    reduced_by: {
      type: 'number',
      description: 'Number of contracts canceled',
    },
    reduced_by_fp: {
      type: 'string',
      description: 'Number of contracts canceled in fixed-point format',
      nullable: true,
    },
  },
}
