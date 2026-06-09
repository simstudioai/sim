import type { KalshiEvent, KalshiPaginationParams, KalshiPagingInfo } from '@/tools/kalshi/types'
import {
  buildKalshiUrl,
  handleKalshiError,
  KALSHI_EVENT_OUTPUT_PROPERTIES,
} from '@/tools/kalshi/types'
import type { ToolConfig } from '@/tools/types'

export interface KalshiGetEventsParams extends KalshiPaginationParams {
  status?: string // open, closed, settled
  seriesTicker?: string
  withNestedMarkets?: string // 'true' or 'false'
}

export interface KalshiGetEventsResponse {
  success: boolean
  output: {
    events: KalshiEvent[]
    paging?: KalshiPagingInfo
  }
}

export const kalshiGetEventsTool: ToolConfig<KalshiGetEventsParams, KalshiGetEventsResponse> = {
  id: 'kalshi_get_events',
  name: 'Get Events from Kalshi',
  description: 'Retrieve a list of events from Kalshi with optional filtering',
  version: '1.0.0',

  params: {
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by event status: "open", "closed", or "settled"',
    },
    seriesTicker: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by series ticker (e.g., "KXBTC", "INX", "FED-RATE")',
    },
    withNestedMarkets: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include nested markets in response: "true" or "false"',
    },
    limit: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return (1-200, default: 200)',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from previous response for fetching next page',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.status) queryParams.append('status', params.status)
      if (params.seriesTicker) queryParams.append('series_ticker', params.seriesTicker)
      if (params.withNestedMarkets)
        queryParams.append('with_nested_markets', params.withNestedMarkets)
      if (params.limit) queryParams.append('limit', params.limit)
      if (params.cursor) queryParams.append('cursor', params.cursor)

      const query = queryParams.toString()
      const url = buildKalshiUrl('/events')
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
      handleKalshiError(data, response.status, 'get_events')
    }

    const events = data.events || []

    return {
      success: true,
      output: {
        events,
        paging: {
          cursor: data.cursor || null,
        },
      },
    }
  },

  outputs: {
    events: {
      type: 'array',
      description: 'Array of event objects',
      items: {
        type: 'object',
        properties: KALSHI_EVENT_OUTPUT_PROPERTIES,
      },
    },
    paging: {
      type: 'object',
      description: 'Pagination cursor for fetching more results',
    },
  },
}

/**
 * V2 Params for Get Events
 */
export interface KalshiGetEventsV2Params extends KalshiPaginationParams {
  status?: string
  seriesTicker?: string
  withNestedMarkets?: string
  withMilestones?: string
  minCloseTs?: number
}

/**
 * V2 Response matching Kalshi API exactly
 */
export interface KalshiGetEventsV2Response {
  success: boolean
  output: {
    events: Array<{
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
      markets: Array<Record<string, unknown>> | null
    }>
    milestones: Array<{
      id: string | null
      category: string | null
      type: string | null
      title: string | null
      start_date: string | null
      end_date: string | null
      notification_message: string | null
      primary_event_tickers: string[] | null
      related_event_tickers: string[] | null
      last_updated_ts: string | null
    }> | null
    cursor: string | null
  }
}

export const kalshiGetEventsV2Tool: ToolConfig<KalshiGetEventsV2Params, KalshiGetEventsV2Response> =
  {
    id: 'kalshi_get_events_v2',
    name: 'Get Events from Kalshi V2',
    description:
      'Retrieve a list of events from Kalshi with optional filtering (V2 - exact API response)',
    version: '2.0.0',

    params: {
      status: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter by event status: "open", "closed", or "settled"',
      },
      seriesTicker: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter by series ticker (e.g., "KXBTC", "INX", "FED-RATE")',
      },
      withNestedMarkets: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Include nested markets in response: "true" or "false"',
      },
      withMilestones: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Include milestones in response: "true" or "false"',
      },
      minCloseTs: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Minimum close timestamp in Unix seconds (e.g., 1704067200)',
      },
      limit: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Number of results to return (1-200, default: 200)',
      },
      cursor: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Pagination cursor from previous response for fetching next page',
      },
    },

    request: {
      url: (params) => {
        const queryParams = new URLSearchParams()
        if (params.status) queryParams.append('status', params.status)
        if (params.seriesTicker) queryParams.append('series_ticker', params.seriesTicker)
        if (params.withNestedMarkets)
          queryParams.append('with_nested_markets', params.withNestedMarkets)
        if (params.withMilestones) queryParams.append('with_milestones', params.withMilestones)
        if (params.minCloseTs !== undefined)
          queryParams.append('min_close_ts', params.minCloseTs.toString())
        if (params.limit) queryParams.append('limit', params.limit)
        if (params.cursor) queryParams.append('cursor', params.cursor)

        const query = queryParams.toString()
        const url = buildKalshiUrl('/events')
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
        handleKalshiError(data, response.status, 'get_events_v2')
      }

      const events = (data.events || []).map((e: Record<string, unknown>) => ({
        event_ticker: e.event_ticker ?? null,
        series_ticker: e.series_ticker ?? null,
        title: e.title ?? null,
        sub_title: e.sub_title ?? null,
        mutually_exclusive: e.mutually_exclusive ?? false,
        category: e.category ?? null,
        collateral_return_type: e.collateral_return_type ?? null,
        strike_date: e.strike_date ?? null,
        strike_period: e.strike_period ?? null,
        available_on_brokers: e.available_on_brokers ?? null,
        product_metadata: e.product_metadata ?? null,
        markets: e.markets ?? null,
      }))

      const milestones = data.milestones
        ? (data.milestones as Array<Record<string, unknown>>).map((m) => ({
            id: (m.id as string) ?? null,
            category: (m.category as string) ?? null,
            type: (m.type as string) ?? null,
            title: (m.title as string | null) ?? null,
            start_date: (m.start_date as string) ?? null,
            end_date: (m.end_date as string) ?? null,
            notification_message: (m.notification_message as string | null) ?? null,
            primary_event_tickers: (m.primary_event_tickers as string[]) ?? null,
            related_event_tickers: (m.related_event_tickers as string[]) ?? null,
            last_updated_ts: (m.last_updated_ts as string) ?? null,
          }))
        : null

      return {
        success: true,
        output: {
          events,
          milestones,
          cursor: data.cursor ?? null,
        },
      }
    },

    outputs: {
      events: {
        type: 'array',
        description: 'Array of event objects',
        items: {
          type: 'object',
          properties: KALSHI_EVENT_OUTPUT_PROPERTIES,
        },
      },
      milestones: {
        type: 'array',
        description: 'Array of milestone objects (if requested)',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Milestone ID' },
            category: { type: 'string', description: 'Milestone category' },
            type: { type: 'string', description: 'Milestone type' },
            title: { type: 'string', description: 'Milestone title' },
            start_date: { type: 'string', description: 'Milestone start date (ISO 8601)' },
            end_date: { type: 'string', description: 'Milestone end date (ISO 8601)' },
            notification_message: { type: 'string', description: 'Notification message' },
            primary_event_tickers: { type: 'array', description: 'Primary event tickers' },
            related_event_tickers: { type: 'array', description: 'Related event tickers' },
            last_updated_ts: { type: 'string', description: 'Last updated time (ISO 8601)' },
          },
        },
      },
      cursor: {
        type: 'string',
        description: 'Pagination cursor for fetching more results',
      },
    },
  }
