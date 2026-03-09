import type { KalshiMarket } from '@/tools/kalshi/types'
import { buildKalshiUrl, handleKalshiError } from '@/tools/kalshi/types'
import type { ToolConfig } from '@/tools/types'

export interface KalshiGetMarketParams {
  ticker: string // Market ticker
}

export interface KalshiGetMarketResponse {
  success: boolean
  output: {
    market: KalshiMarket
  }
}

export const kalshiGetMarketTool: ToolConfig<KalshiGetMarketParams, KalshiGetMarketResponse> = {
  id: 'kalshi_get_market',
  name: 'Get Market from Kalshi',
  description: 'Retrieve details of a specific prediction market by ticker',
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
    url: (params) => buildKalshiUrl(`/markets/${params.ticker}`),
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handleKalshiError(data, response.status, 'get_market')
    }

    return {
      success: true,
      output: {
        market: data.market,
      },
    }
  },

  outputs: {
    market: {
      type: 'object',
      description: 'Market object with details',
    },
  },
}

/**
 * V2 Get Market Tool - Returns exact Kalshi API response structure
 */
export interface KalshiGetMarketV2Response {
  success: boolean
  output: {
    market: {
      ticker: string
      event_ticker: string
      market_type: string
      title: string
      subtitle: string | null
      yes_sub_title: string | null
      no_sub_title: string | null
      open_time: string | null
      close_time: string | null
      expected_expiration_time: string | null
      expiration_time: string | null
      latest_expiration_time: string | null
      settlement_timer_seconds: number | null
      status: string
      response_price_units: string | null
      notional_value: number | null
      tick_size: number | null
      yes_bid: number | null
      yes_ask: number | null
      no_bid: number | null
      no_ask: number | null
      last_price: number | null
      previous_yes_bid: number | null
      previous_yes_ask: number | null
      previous_price: number | null
      volume: number | null
      volume_24h: number | null
      liquidity: number | null
      open_interest: number | null
      result: string | null
      cap_strike: number | null
      floor_strike: number | null
      can_close_early: boolean | null
      expiration_value: string | null
      category: string | null
      risk_limit_cents: number | null
      strike_type: string | null
      rules_primary: string | null
      rules_secondary: string | null
      settlement_source_url: string | null
      custom_strike: object | null
      underlying: string | null
      settlement_value: number | null
      cfd_contract_size: number | null
      yes_fee_fp: number | null
      no_fee_fp: number | null
      last_price_fp: number | null
      yes_bid_fp: number | null
      yes_ask_fp: number | null
      no_bid_fp: number | null
      no_ask_fp: number | null
    }
  }
}

export const kalshiGetMarketV2Tool: ToolConfig<KalshiGetMarketParams, KalshiGetMarketV2Response> = {
  id: 'kalshi_get_market_v2',
  name: 'Get Market from Kalshi V2',
  description:
    'Retrieve details of a specific prediction market by ticker (V2 - full API response)',
  version: '2.0.0',

  params: {
    ticker: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Market ticker identifier (e.g., "KXBTC-24DEC31", "INX-25JAN03-T4485.99")',
    },
  },

  request: {
    url: (params) => buildKalshiUrl(`/markets/${params.ticker}`),
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handleKalshiError(data, response.status, 'get_market_v2')
    }

    const m = data.market || {}

    return {
      success: true,
      output: {
        market: {
          ticker: m.ticker ?? null,
          event_ticker: m.event_ticker ?? null,
          market_type: m.market_type ?? null,
          title: m.title ?? null,
          subtitle: m.subtitle ?? null,
          yes_sub_title: m.yes_sub_title ?? null,
          no_sub_title: m.no_sub_title ?? null,
          open_time: m.open_time ?? null,
          close_time: m.close_time ?? null,
          expected_expiration_time: m.expected_expiration_time ?? null,
          expiration_time: m.expiration_time ?? null,
          latest_expiration_time: m.latest_expiration_time ?? null,
          settlement_timer_seconds: m.settlement_timer_seconds ?? null,
          status: m.status ?? null,
          response_price_units: m.response_price_units ?? null,
          notional_value: m.notional_value ?? null,
          tick_size: m.tick_size ?? null,
          yes_bid: m.yes_bid ?? null,
          yes_ask: m.yes_ask ?? null,
          no_bid: m.no_bid ?? null,
          no_ask: m.no_ask ?? null,
          last_price: m.last_price ?? null,
          previous_yes_bid: m.previous_yes_bid ?? null,
          previous_yes_ask: m.previous_yes_ask ?? null,
          previous_price: m.previous_price ?? null,
          volume: m.volume ?? null,
          volume_24h: m.volume_24h ?? null,
          liquidity: m.liquidity ?? null,
          open_interest: m.open_interest ?? null,
          result: m.result ?? null,
          cap_strike: m.cap_strike ?? null,
          floor_strike: m.floor_strike ?? null,
          can_close_early: m.can_close_early ?? null,
          expiration_value: m.expiration_value ?? null,
          category: m.category ?? null,
          risk_limit_cents: m.risk_limit_cents ?? null,
          strike_type: m.strike_type ?? null,
          rules_primary: m.rules_primary ?? null,
          rules_secondary: m.rules_secondary ?? null,
          settlement_source_url: m.settlement_source_url ?? null,
          custom_strike: m.custom_strike ?? null,
          underlying: m.underlying ?? null,
          settlement_value: m.settlement_value ?? null,
          cfd_contract_size: m.cfd_contract_size ?? null,
          yes_fee_fp: m.yes_fee_fp ?? null,
          no_fee_fp: m.no_fee_fp ?? null,
          last_price_fp: m.last_price_fp ?? null,
          yes_bid_fp: m.yes_bid_fp ?? null,
          yes_ask_fp: m.yes_ask_fp ?? null,
          no_bid_fp: m.no_bid_fp ?? null,
          no_ask_fp: m.no_ask_fp ?? null,
        },
      },
    }
  },

  outputs: {
    market: {
      type: 'object',
      description: 'Market object with all API fields',
      properties: {
        ticker: { type: 'string', description: 'Market ticker' },
        event_ticker: { type: 'string', description: 'Event ticker' },
        market_type: { type: 'string', description: 'Market type' },
        title: { type: 'string', description: 'Market title' },
        subtitle: { type: 'string', description: 'Market subtitle' },
        yes_sub_title: { type: 'string', description: 'Yes outcome subtitle' },
        no_sub_title: { type: 'string', description: 'No outcome subtitle' },
        open_time: { type: 'string', description: 'Market open time' },
        close_time: { type: 'string', description: 'Market close time' },
        expected_expiration_time: { type: 'string', description: 'Expected expiration time' },
        expiration_time: { type: 'string', description: 'Expiration time' },
        latest_expiration_time: { type: 'string', description: 'Latest expiration time' },
        settlement_timer_seconds: { type: 'number', description: 'Settlement timer in seconds' },
        status: { type: 'string', description: 'Market status' },
        response_price_units: { type: 'string', description: 'Response price units' },
        notional_value: { type: 'number', description: 'Notional value' },
        tick_size: { type: 'number', description: 'Tick size' },
        yes_bid: { type: 'number', description: 'Current yes bid price' },
        yes_ask: { type: 'number', description: 'Current yes ask price' },
        no_bid: { type: 'number', description: 'Current no bid price' },
        no_ask: { type: 'number', description: 'Current no ask price' },
        last_price: { type: 'number', description: 'Last trade price' },
        previous_yes_bid: { type: 'number', description: 'Previous yes bid' },
        previous_yes_ask: { type: 'number', description: 'Previous yes ask' },
        previous_price: { type: 'number', description: 'Previous price' },
        volume: { type: 'number', description: 'Total volume' },
        volume_24h: { type: 'number', description: '24-hour volume' },
        liquidity: { type: 'number', description: 'Market liquidity' },
        open_interest: { type: 'number', description: 'Open interest' },
        result: { type: 'string', description: 'Market result' },
        cap_strike: { type: 'number', description: 'Cap strike' },
        floor_strike: { type: 'number', description: 'Floor strike' },
        can_close_early: { type: 'boolean', description: 'Can close early' },
        expiration_value: { type: 'string', description: 'Expiration value' },
        category: { type: 'string', description: 'Market category' },
        risk_limit_cents: { type: 'number', description: 'Risk limit in cents' },
        strike_type: { type: 'string', description: 'Strike type' },
        rules_primary: { type: 'string', description: 'Primary rules' },
        rules_secondary: { type: 'string', description: 'Secondary rules' },
        settlement_source_url: { type: 'string', description: 'Settlement source URL' },
        custom_strike: { type: 'object', description: 'Custom strike object' },
        underlying: { type: 'string', description: 'Underlying asset' },
        settlement_value: { type: 'number', description: 'Settlement value' },
        cfd_contract_size: { type: 'number', description: 'CFD contract size' },
        yes_fee_fp: { type: 'number', description: 'Yes fee (fixed-point)' },
        no_fee_fp: { type: 'number', description: 'No fee (fixed-point)' },
        last_price_fp: { type: 'number', description: 'Last price (fixed-point)' },
        yes_bid_fp: { type: 'number', description: 'Yes bid (fixed-point)' },
        yes_ask_fp: { type: 'number', description: 'Yes ask (fixed-point)' },
        no_bid_fp: { type: 'number', description: 'No bid (fixed-point)' },
        no_ask_fp: { type: 'number', description: 'No ask (fixed-point)' },
      },
    },
  },
}
