import {
  buildKalshiUrl,
  handleKalshiError,
  KALSHI_ANNOUNCEMENT_OUTPUT_PROPERTIES,
} from '@/tools/kalshi/types'
import type { ToolConfig } from '@/tools/types'

export type KalshiGetExchangeAnnouncementsParams = Record<string, never>

export interface KalshiGetExchangeAnnouncementsResponse {
  success: boolean
  output: {
    announcements: Array<Record<string, unknown>>
  }
}

export const kalshiGetExchangeAnnouncementsTool: ToolConfig<
  KalshiGetExchangeAnnouncementsParams,
  KalshiGetExchangeAnnouncementsResponse
> = {
  id: 'kalshi_get_exchange_announcements',
  name: 'Get Exchange Announcements from Kalshi',
  description: 'Retrieve exchange-wide announcements from Kalshi',
  version: '1.0.0',

  params: {},

  request: {
    url: () => buildKalshiUrl('/exchange/announcements'),
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handleKalshiError(data, response.status, 'get_exchange_announcements')
    }

    return {
      success: true,
      output: {
        announcements: data.announcements || [],
      },
    }
  },

  outputs: {
    announcements: {
      type: 'array',
      description: 'Array of exchange announcement objects',
      items: {
        type: 'object',
        properties: KALSHI_ANNOUNCEMENT_OUTPUT_PROPERTIES,
      },
    },
  },
}

/**
 * V2 Response matching Kalshi API exactly
 */
export interface KalshiGetExchangeAnnouncementsV2Response {
  success: boolean
  output: {
    announcements: Array<{
      type: string | null
      message: string | null
      delivery_time: string | null
      status: string | null
    }>
  }
}

export const kalshiGetExchangeAnnouncementsV2Tool: ToolConfig<
  KalshiGetExchangeAnnouncementsParams,
  KalshiGetExchangeAnnouncementsV2Response
> = {
  id: 'kalshi_get_exchange_announcements_v2',
  name: 'Get Exchange Announcements from Kalshi V2',
  description: 'Retrieve exchange-wide announcements from Kalshi (V2 - exact API response)',
  version: '2.0.0',

  params: {},

  request: {
    url: () => buildKalshiUrl('/exchange/announcements'),
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handleKalshiError(data, response.status, 'get_exchange_announcements_v2')
    }

    const announcements = (data.announcements || []).map((a: Record<string, unknown>) => ({
      type: a.type ?? null,
      message: a.message ?? null,
      delivery_time: a.delivery_time ?? null,
      status: a.status ?? null,
    }))

    return {
      success: true,
      output: {
        announcements,
      },
    }
  },

  outputs: {
    announcements: {
      type: 'array',
      description: 'Array of exchange announcement objects',
      items: {
        type: 'object',
        properties: KALSHI_ANNOUNCEMENT_OUTPUT_PROPERTIES,
      },
    },
  },
}
