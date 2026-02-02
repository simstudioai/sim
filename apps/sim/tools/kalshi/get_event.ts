import type { KalshiEvent } from '@/tools/kalshi/types'
import { buildKalshiUrl, handleKalshiError } from '@/tools/kalshi/types'
import type { ToolConfig } from '@/tools/types'

export interface KalshiGetEventParams {
  eventTicker: string // Event ticker
  withNestedMarkets?: string // 'true' or 'false'
}

export interface KalshiGetEventResponse {
  success: boolean
  output: {
    event: KalshiEvent
  }
}

export const kalshiGetEventTool: ToolConfig<KalshiGetEventParams, KalshiGetEventResponse> = {
  id: 'kalshi_get_event',
  name: 'Get Event from Kalshi',
  description: 'Retrieve details of a specific event by ticker',
  version: '1.0.0',

  params: {
    eventTicker: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Event ticker identifier (e.g., "KXBTC-24DEC31", "INX-25JAN03")',
    },
    withNestedMarkets: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include nested markets in response (true/false)',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.withNestedMarkets)
        queryParams.append('with_nested_markets', params.withNestedMarkets)

      const query = queryParams.toString()
      const url = buildKalshiUrl(`/events/${params.eventTicker}`)
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
      handleKalshiError(data, response.status, 'get_event')
    }

    return {
      success: true,
      output: {
        event: data.event,
      },
    }
  },

  outputs: {
    event: {
      type: 'object',
      description: 'Event object with details',
    },
  },
}

/**
 * V2 Params for Get Event
 */
export interface KalshiGetEventV2Params {
  eventTicker: string
  withNestedMarkets?: string
}

/**
 * V2 Response matching Kalshi API exactly
 */
export interface KalshiGetEventV2Response {
  success: boolean
  output: {
    event: {
      event_ticker: string
      series_ticker: string
      title: string
      sub_title: string | null
      mutually_exclusive: boolean
      category: string
      collateral_return_type: string | null
      strike_date: string | null
      strike_period: string | null
      available_on_brokers: boolean | null
      product_metadata: Record<string, unknown> | null
      markets: Array<{
        ticker: string
        event_ticker: string
        market_type: string
        title: string
        subtitle: string | null
        yes_sub_title: string | null
        no_sub_title: string | null
        open_time: string
        close_time: string
        expiration_time: string
        status: string
        yes_bid: number
        yes_ask: number
        no_bid: number
        no_ask: number
        last_price: number
        previous_yes_bid: number | null
        previous_yes_ask: number | null
        previous_price: number | null
        volume: number
        volume_24h: number
        liquidity: number | null
        open_interest: number | null
        result: string | null
        cap_strike: number | null
        floor_strike: number | null
      }> | null
    }
  }
}

export const kalshiGetEventV2Tool: ToolConfig<KalshiGetEventV2Params, KalshiGetEventV2Response> = {
  id: 'kalshi_get_event_v2',
  name: 'Get Event from Kalshi V2',
  description: 'Retrieve details of a specific event by ticker (V2 - exact API response)',
  version: '2.0.0',

  params: {
    eventTicker: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Event ticker identifier (e.g., "KXBTC-24DEC31", "INX-25JAN03")',
    },
    withNestedMarkets: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include nested markets in response (true/false)',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.withNestedMarkets)
        queryParams.append('with_nested_markets', params.withNestedMarkets)

      const query = queryParams.toString()
      const url = buildKalshiUrl(`/events/${params.eventTicker}`)
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
      handleKalshiError(data, response.status, 'get_event_v2')
    }

    const event = data.event || {}
    const markets =
      event.markets?.map((m: Record<string, unknown>) => ({
        ticker: m.ticker ?? null,
        event_ticker: m.event_ticker ?? null,
        market_type: m.market_type ?? null,
        title: m.title ?? null,
        subtitle: m.subtitle ?? null,
        yes_sub_title: m.yes_sub_title ?? null,
        no_sub_title: m.no_sub_title ?? null,
        open_time: m.open_time ?? null,
        close_time: m.close_time ?? null,
        expiration_time: m.expiration_time ?? null,
        status: m.status ?? null,
        yes_bid: m.yes_bid ?? 0,
        yes_ask: m.yes_ask ?? 0,
        no_bid: m.no_bid ?? 0,
        no_ask: m.no_ask ?? 0,
        last_price: m.last_price ?? 0,
        previous_yes_bid: m.previous_yes_bid ?? null,
        previous_yes_ask: m.previous_yes_ask ?? null,
        previous_price: m.previous_price ?? null,
        volume: m.volume ?? 0,
        volume_24h: m.volume_24h ?? 0,
        liquidity: m.liquidity ?? null,
        open_interest: m.open_interest ?? null,
        result: m.result ?? null,
        cap_strike: m.cap_strike ?? null,
        floor_strike: m.floor_strike ?? null,
      })) ?? null

    return {
      success: true,
      output: {
        event: {
          event_ticker: event.event_ticker ?? null,
          series_ticker: event.series_ticker ?? null,
          title: event.title ?? null,
          sub_title: event.sub_title ?? null,
          mutually_exclusive: event.mutually_exclusive ?? false,
          category: event.category ?? null,
          collateral_return_type: event.collateral_return_type ?? null,
          strike_date: event.strike_date ?? null,
          strike_period: event.strike_period ?? null,
          available_on_brokers: event.available_on_brokers ?? null,
          product_metadata: event.product_metadata ?? null,
          markets,
        },
      },
    }
  },

  outputs: {
    event: {
      type: 'object',
      description: 'Event object with full details matching Kalshi API response',
      properties: {
        event_ticker: { type: 'string', description: 'Event ticker' },
        series_ticker: { type: 'string', description: 'Series ticker' },
        title: { type: 'string', description: 'Event title' },
        sub_title: { type: 'string', description: 'Event subtitle' },
        mutually_exclusive: { type: 'boolean', description: 'Mutually exclusive markets' },
        category: { type: 'string', description: 'Event category' },
        collateral_return_type: { type: 'string', description: 'Collateral return type' },
        strike_date: { type: 'string', description: 'Strike date' },
        strike_period: { type: 'string', description: 'Strike period' },
        available_on_brokers: { type: 'boolean', description: 'Available on brokers' },
        product_metadata: { type: 'object', description: 'Product metadata' },
        markets: { type: 'array', description: 'Nested markets (if requested)' },
      },
    },
  },
}
