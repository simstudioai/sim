import type { ToolConfig } from '@/tools/types'
import type { KalshiEvent } from './types'
import { buildKalshiUrl, handleKalshiError } from './types'

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
      description: 'The event ticker',
    },
    withNestedMarkets: {
      type: 'string',
      required: false,
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
