import type { KalshiCandlestick } from '@/tools/kalshi/types'
import { buildKalshiUrl, handleKalshiError } from '@/tools/kalshi/types'
import type { ToolConfig } from '@/tools/types'

export interface KalshiGetCandlesticksParams {
  seriesTicker: string
  ticker: string
  startTs: number
  endTs: number
  periodInterval: number // 1, 60, or 1440 (1min, 1hour, 1day)
}

export interface KalshiGetCandlesticksResponse {
  success: boolean
  output: {
    candlesticks: KalshiCandlestick[]
  }
}

export const kalshiGetCandlesticksTool: ToolConfig<
  KalshiGetCandlesticksParams,
  KalshiGetCandlesticksResponse
> = {
  id: 'kalshi_get_candlesticks',
  name: 'Get Market Candlesticks from Kalshi',
  description: 'Retrieve OHLC candlestick data for a specific market',
  version: '1.0.0',

  params: {
    seriesTicker: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Series ticker identifier (e.g., "KXBTC", "INX", "FED-RATE")',
    },
    ticker: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Market ticker identifier (e.g., "KXBTC-24DEC31", "INX-25JAN03-T4485.99")',
    },
    startTs: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Start timestamp in Unix seconds (e.g., 1704067200)',
    },
    endTs: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'End timestamp in Unix seconds (e.g., 1704153600)',
    },
    periodInterval: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Period interval: 1 (1 minute), 60 (1 hour), or 1440 (1 day)',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      queryParams.append('start_ts', params.startTs.toString())
      queryParams.append('end_ts', params.endTs.toString())
      queryParams.append('period_interval', params.periodInterval.toString())

      const query = queryParams.toString()
      const url = buildKalshiUrl(
        `/series/${params.seriesTicker}/markets/${params.ticker}/candlesticks`
      )
      return `${url}?${query}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handleKalshiError(data, response.status, 'get_candlesticks')
    }

    const candlesticks = data.candlesticks || []

    return {
      success: true,
      output: {
        candlesticks,
      },
    }
  },

  outputs: {
    candlesticks: {
      type: 'array',
      description: 'Array of OHLC candlestick data',
    },
  },
}

/**
 * BidAskDistribution - OHLC data for yes_bid and yes_ask
 */
export interface BidAskDistribution {
  open: number | null
  open_dollars: string | null
  low: number | null
  low_dollars: string | null
  high: number | null
  high_dollars: string | null
  close: number | null
  close_dollars: string | null
}

/**
 * PriceDistribution - Extended OHLC data for price field
 */
export interface PriceDistribution {
  open: number | null
  open_dollars: string | null
  low: number | null
  low_dollars: string | null
  high: number | null
  high_dollars: string | null
  close: number | null
  close_dollars: string | null
  mean: number | null
  mean_dollars: string | null
  previous: number | null
  previous_dollars: string | null
  min: number | null
  min_dollars: string | null
  max: number | null
  max_dollars: string | null
}

/**
 * V2 Get Candlesticks Tool - Returns exact Kalshi API response structure
 */
export interface KalshiGetCandlesticksV2Response {
  success: boolean
  output: {
    ticker: string
    candlesticks: Array<{
      end_period_ts: number | null
      yes_bid: BidAskDistribution
      yes_ask: BidAskDistribution
      price: PriceDistribution
      volume: number | null
      volume_fp: string | null
      open_interest: number | null
      open_interest_fp: string | null
    }>
  }
}

export const kalshiGetCandlesticksV2Tool: ToolConfig<
  KalshiGetCandlesticksParams,
  KalshiGetCandlesticksV2Response
> = {
  id: 'kalshi_get_candlesticks_v2',
  name: 'Get Market Candlesticks from Kalshi V2',
  description: 'Retrieve OHLC candlestick data for a specific market (V2 - full API response)',
  version: '2.0.0',

  params: {
    seriesTicker: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Series ticker identifier (e.g., "KXBTC", "INX", "FED-RATE")',
    },
    ticker: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Market ticker identifier (e.g., "KXBTC-24DEC31", "INX-25JAN03-T4485.99")',
    },
    startTs: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Start timestamp in Unix seconds (e.g., 1704067200)',
    },
    endTs: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'End timestamp in Unix seconds (e.g., 1704153600)',
    },
    periodInterval: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Period interval: 1 (1 minute), 60 (1 hour), or 1440 (1 day)',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      queryParams.append('start_ts', params.startTs.toString())
      queryParams.append('end_ts', params.endTs.toString())
      queryParams.append('period_interval', params.periodInterval.toString())

      const query = queryParams.toString()
      const url = buildKalshiUrl(
        `/series/${params.seriesTicker}/markets/${params.ticker}/candlesticks`
      )
      return `${url}?${query}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handleKalshiError(data, response.status, 'get_candlesticks_v2')
    }

    const mapBidAsk = (obj: Record<string, unknown> | null): BidAskDistribution => ({
      open: (obj?.open as number) ?? null,
      open_dollars: (obj?.open_dollars as string) ?? null,
      low: (obj?.low as number) ?? null,
      low_dollars: (obj?.low_dollars as string) ?? null,
      high: (obj?.high as number) ?? null,
      high_dollars: (obj?.high_dollars as string) ?? null,
      close: (obj?.close as number) ?? null,
      close_dollars: (obj?.close_dollars as string) ?? null,
    })

    const mapPrice = (obj: Record<string, unknown> | null): PriceDistribution => ({
      open: (obj?.open as number) ?? null,
      open_dollars: (obj?.open_dollars as string) ?? null,
      low: (obj?.low as number) ?? null,
      low_dollars: (obj?.low_dollars as string) ?? null,
      high: (obj?.high as number) ?? null,
      high_dollars: (obj?.high_dollars as string) ?? null,
      close: (obj?.close as number) ?? null,
      close_dollars: (obj?.close_dollars as string) ?? null,
      mean: (obj?.mean as number) ?? null,
      mean_dollars: (obj?.mean_dollars as string) ?? null,
      previous: (obj?.previous as number) ?? null,
      previous_dollars: (obj?.previous_dollars as string) ?? null,
      min: (obj?.min as number) ?? null,
      min_dollars: (obj?.min_dollars as string) ?? null,
      max: (obj?.max as number) ?? null,
      max_dollars: (obj?.max_dollars as string) ?? null,
    })

    const candlesticks = (data.candlesticks || []).map((c: Record<string, unknown>) => ({
      end_period_ts: (c.end_period_ts as number) ?? null,
      yes_bid: mapBidAsk(c.yes_bid as Record<string, unknown> | null),
      yes_ask: mapBidAsk(c.yes_ask as Record<string, unknown> | null),
      price: mapPrice(c.price as Record<string, unknown> | null),
      volume: (c.volume as number) ?? null,
      volume_fp: (c.volume_fp as string) ?? null,
      open_interest: (c.open_interest as number) ?? null,
      open_interest_fp: (c.open_interest_fp as string) ?? null,
    }))

    return {
      success: true,
      output: {
        ticker: data.ticker ?? null,
        candlesticks,
      },
    }
  },

  outputs: {
    ticker: {
      type: 'string',
      description: 'Market ticker',
    },
    candlesticks: {
      type: 'array',
      description: 'Array of OHLC candlestick data with nested bid/ask/price objects',
      properties: {
        end_period_ts: { type: 'number', description: 'End period timestamp (Unix)' },
        yes_bid: {
          type: 'object',
          description: 'Yes bid OHLC data',
          properties: {
            open: { type: 'number', description: 'Open price (cents)' },
            open_dollars: { type: 'string', description: 'Open price (dollars)' },
            low: { type: 'number', description: 'Low price (cents)' },
            low_dollars: { type: 'string', description: 'Low price (dollars)' },
            high: { type: 'number', description: 'High price (cents)' },
            high_dollars: { type: 'string', description: 'High price (dollars)' },
            close: { type: 'number', description: 'Close price (cents)' },
            close_dollars: { type: 'string', description: 'Close price (dollars)' },
          },
        },
        yes_ask: {
          type: 'object',
          description: 'Yes ask OHLC data',
          properties: {
            open: { type: 'number', description: 'Open price (cents)' },
            open_dollars: { type: 'string', description: 'Open price (dollars)' },
            low: { type: 'number', description: 'Low price (cents)' },
            low_dollars: { type: 'string', description: 'Low price (dollars)' },
            high: { type: 'number', description: 'High price (cents)' },
            high_dollars: { type: 'string', description: 'High price (dollars)' },
            close: { type: 'number', description: 'Close price (cents)' },
            close_dollars: { type: 'string', description: 'Close price (dollars)' },
          },
        },
        price: {
          type: 'object',
          description: 'Trade price OHLC data with additional statistics',
          properties: {
            open: { type: 'number', description: 'Open price (cents)' },
            open_dollars: { type: 'string', description: 'Open price (dollars)' },
            low: { type: 'number', description: 'Low price (cents)' },
            low_dollars: { type: 'string', description: 'Low price (dollars)' },
            high: { type: 'number', description: 'High price (cents)' },
            high_dollars: { type: 'string', description: 'High price (dollars)' },
            close: { type: 'number', description: 'Close price (cents)' },
            close_dollars: { type: 'string', description: 'Close price (dollars)' },
            mean: { type: 'number', description: 'Mean price (cents)' },
            mean_dollars: { type: 'string', description: 'Mean price (dollars)' },
            previous: { type: 'number', description: 'Previous price (cents)' },
            previous_dollars: { type: 'string', description: 'Previous price (dollars)' },
            min: { type: 'number', description: 'Min price (cents)' },
            min_dollars: { type: 'string', description: 'Min price (dollars)' },
            max: { type: 'number', description: 'Max price (cents)' },
            max_dollars: { type: 'string', description: 'Max price (dollars)' },
          },
        },
        volume: { type: 'number', description: 'Volume (contracts)' },
        volume_fp: { type: 'string', description: 'Volume (fixed-point string)' },
        open_interest: { type: 'number', description: 'Open interest (contracts)' },
        open_interest_fp: { type: 'string', description: 'Open interest (fixed-point string)' },
      },
    },
  },
}
