import { buildKalshiUrl, handleKalshiError } from '@/tools/kalshi/types'
import type { ToolConfig } from '@/tools/types'

export interface KalshiGetEventCandlesticksParams {
  seriesTicker: string
  eventTicker: string
  startTs: number
  endTs: number
  periodInterval: number // 1, 60, or 1440 (1min, 1hour, 1day)
}

export interface KalshiGetEventCandlesticksResponse {
  success: boolean
  output: {
    market_candlesticks: Array<Record<string, unknown>>
  }
}

export const kalshiGetEventCandlesticksTool: ToolConfig<
  KalshiGetEventCandlesticksParams,
  KalshiGetEventCandlesticksResponse
> = {
  id: 'kalshi_get_event_candlesticks',
  name: 'Get Event Candlesticks from Kalshi',
  description: 'Retrieve OHLC candlestick data aggregated across all markets in an event',
  version: '1.0.0',

  params: {
    seriesTicker: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Series ticker identifier (e.g., "KXBTC", "INX", "FED-RATE")',
    },
    eventTicker: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Event ticker identifier (e.g., "KXBTC-24DEC31", "INX-25JAN03")',
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

      const url = buildKalshiUrl(
        `/series/${params.seriesTicker.trim()}/events/${params.eventTicker.trim()}/candlesticks`
      )
      return `${url}?${queryParams.toString()}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handleKalshiError(data, response.status, 'get_event_candlesticks')
    }

    return {
      success: true,
      output: {
        market_candlesticks: data.market_candlesticks || [],
      },
    }
  },

  outputs: {
    market_candlesticks: {
      type: 'array',
      description: 'Array of event-level aggregated OHLC candlestick data',
    },
  },
}

/**
 * BidAskDistribution - OHLC data for yes_bid and yes_ask
 */
interface BidAskDistribution {
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
 * PriceDistribution - Extended OHLC data for the price field
 */
interface PriceDistribution {
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
}

/**
 * V2 Get Event Candlesticks Tool - Returns exact Kalshi API response structure
 */
export interface KalshiGetEventCandlesticksV2Response {
  success: boolean
  output: {
    market_tickers: string[] | null
    adjusted_end_ts: number | null
    market_candlesticks: Array<{
      end_period_ts: number | null
      yes_bid: BidAskDistribution
      yes_ask: BidAskDistribution
      price: PriceDistribution
      volume_fp: string | null
      open_interest_fp: string | null
    }>
  }
}

export const kalshiGetEventCandlesticksV2Tool: ToolConfig<
  KalshiGetEventCandlesticksParams,
  KalshiGetEventCandlesticksV2Response
> = {
  id: 'kalshi_get_event_candlesticks_v2',
  name: 'Get Event Candlesticks from Kalshi V2',
  description:
    'Retrieve OHLC candlestick data aggregated across all markets in an event (V2 - full API response)',
  version: '2.0.0',

  params: {
    seriesTicker: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Series ticker identifier (e.g., "KXBTC", "INX", "FED-RATE")',
    },
    eventTicker: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Event ticker identifier (e.g., "KXBTC-24DEC31", "INX-25JAN03")',
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

      const url = buildKalshiUrl(
        `/series/${params.seriesTicker.trim()}/events/${params.eventTicker.trim()}/candlesticks`
      )
      return `${url}?${queryParams.toString()}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handleKalshiError(data, response.status, 'get_event_candlesticks_v2')
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
    })

    const candlesticks = (data.market_candlesticks || []).map((c: Record<string, unknown>) => ({
      end_period_ts: (c.end_period_ts as number) ?? null,
      yes_bid: mapBidAsk(c.yes_bid as Record<string, unknown> | null),
      yes_ask: mapBidAsk(c.yes_ask as Record<string, unknown> | null),
      price: mapPrice(c.price as Record<string, unknown> | null),
      volume_fp: (c.volume_fp as string) ?? null,
      open_interest_fp: (c.open_interest_fp as string) ?? null,
    }))

    return {
      success: true,
      output: {
        market_tickers: data.market_tickers ?? null,
        adjusted_end_ts: data.adjusted_end_ts ?? null,
        market_candlesticks: candlesticks,
      },
    }
  },

  outputs: {
    market_tickers: {
      type: 'array',
      description: 'Market tickers included in the aggregated candlesticks',
    },
    adjusted_end_ts: {
      type: 'number',
      description: 'Adjusted end timestamp used for the candlestick range (Unix seconds)',
    },
    market_candlesticks: {
      type: 'array',
      description:
        'Array of event-level aggregated OHLC candlestick data with nested bid/ask/price',
      properties: {
        end_period_ts: { type: 'number', description: 'End period timestamp (Unix)' },
        yes_bid: { type: 'object', description: 'Yes bid OHLC data' },
        yes_ask: { type: 'object', description: 'Yes ask OHLC data' },
        price: { type: 'object', description: 'Trade price OHLC data with statistics' },
        volume_fp: { type: 'string', description: 'Volume (fixed-point string)' },
        open_interest_fp: { type: 'string', description: 'Open interest (fixed-point string)' },
      },
    },
  },
}
