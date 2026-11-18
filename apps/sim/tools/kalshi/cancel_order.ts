import type { KalshiAuthParams } from '@/tools/kalshi/types'
import { buildKalshiAuthHeaders, buildKalshiUrl, handleKalshiError } from '@/tools/kalshi/types'
import { KALSHI_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

/**
 * Cancel Order (V2): Kalshi removed `DELETE /portfolio/orders/{id}` (410 `deprecated_v1_order_endpoint`).
 * With no `exchange_index` or `market_ticker` it routes to shard 0, as the removed endpoint did.
 */
function cancelOrderPath(orderId: string): string {
  return `/portfolio/events/orders/${safeUrlPathSegment(orderId, 'orderId')}`
}

/** Kalshi's V2 cancel returns `reduced_by` as a fixed-point count string ("10.00"). */
function reducedByCount(reducedBy: unknown): number {
  const count = Number(reducedBy)
  return Number.isFinite(count) ? count : 0
}

export interface KalshiCancelOrderParams extends KalshiAuthParams {
  orderId: string // Order ID to cancel (required)
}

export interface KalshiCancelOrderResponse {
  success: boolean
  output: {
    order: { order_id: string | null; client_order_id: string | null }
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
    },

    request: {
      url: (params) => buildKalshiUrl(cancelOrderPath(params.orderId)),
      method: 'DELETE',
      headers: (params) =>
        buildKalshiAuthHeaders(
          params.keyId,
          params.privateKey,
          'DELETE',
          `/trade-api/v2${cancelOrderPath(params.orderId)}`
        ),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!response.ok) {
        handleKalshiError(data, 'cancel_order')
      }

      // V2 returns only the order's identity, not the full order object.
      return {
        success: true,
        output: {
          order: {
            order_id: data.order_id ?? null,
            client_order_id: data.client_order_id ?? null,
          },
          reducedBy: reducedByCount(data.reduced_by),
        },
      }
    },

    outputs: {
      order: {
        type: 'object',
        description:
          'The canceled order: order_id and client_order_id (Kalshi no longer returns the full order on cancel)',
      },
      reducedBy: {
        type: 'number',
        description: 'Number of contracts canceled',
      },
    },
  }

export interface KalshiCancelOrderV2Params extends KalshiAuthParams {
  orderId: string // Order ID to cancel (required)
}

export interface KalshiCancelOrderV2Response {
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
  },

  request: {
    url: (params) => buildKalshiUrl(cancelOrderPath(params.orderId)),
    method: 'DELETE',
    headers: (params) =>
      buildKalshiAuthHeaders(
        params.keyId,
        params.privateKey,
        'DELETE',
        `/trade-api/v2${cancelOrderPath(params.orderId)}`
      ),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handleKalshiError(data, 'cancel_order_v2')
    }

    // V2 returns only the order's identity, so the other order fields are unknown here.
    return {
      success: true,
      output: {
        order: {
          order_id: data.order_id ?? null,
          user_id: null,
          client_order_id: data.client_order_id ?? null,
          ticker: null,
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
        reduced_by: reducedByCount(data.reduced_by),
        reduced_by_fp: typeof data.reduced_by === 'string' ? data.reduced_by : null,
      },
    }
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
