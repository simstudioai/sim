import { buildKalshiUrl, handleKalshiError } from '@/tools/kalshi/types'
import type { ToolConfig } from '@/tools/types'

export type KalshiGetExchangeScheduleParams = Record<string, never>

export interface KalshiGetExchangeScheduleResponse {
  success: boolean
  output: {
    schedule: Record<string, unknown>
  }
}

export const kalshiGetExchangeScheduleTool: ToolConfig<
  KalshiGetExchangeScheduleParams,
  KalshiGetExchangeScheduleResponse
> = {
  id: 'kalshi_get_exchange_schedule',
  name: 'Get Exchange Schedule from Kalshi',
  description: 'Retrieve the Kalshi exchange trading schedule and maintenance windows',
  version: '1.0.0',

  params: {},

  request: {
    url: () => buildKalshiUrl('/exchange/schedule'),
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handleKalshiError(data, response.status, 'get_exchange_schedule')
    }

    return {
      success: true,
      output: {
        schedule: data.schedule || {},
      },
    }
  },

  outputs: {
    schedule: {
      type: 'object',
      description: 'Exchange schedule with standard_hours and maintenance_windows',
    },
  },
}

/**
 * V2 Response matching Kalshi API exactly
 */
export interface KalshiGetExchangeScheduleV2Response {
  success: boolean
  output: {
    schedule: {
      standard_hours: Array<Record<string, unknown>>
      maintenance_windows: Array<{
        start_datetime: string | null
        end_datetime: string | null
      }>
    }
  }
}

export const kalshiGetExchangeScheduleV2Tool: ToolConfig<
  KalshiGetExchangeScheduleParams,
  KalshiGetExchangeScheduleV2Response
> = {
  id: 'kalshi_get_exchange_schedule_v2',
  name: 'Get Exchange Schedule from Kalshi V2',
  description:
    'Retrieve the Kalshi exchange trading schedule and maintenance windows (V2 - exact API response)',
  version: '2.0.0',

  params: {},

  request: {
    url: () => buildKalshiUrl('/exchange/schedule'),
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handleKalshiError(data, response.status, 'get_exchange_schedule_v2')
    }

    const schedule = data.schedule || {}
    const maintenanceWindows = (schedule.maintenance_windows || []).map(
      (w: Record<string, unknown>) => ({
        start_datetime: (w.start_datetime as string) ?? null,
        end_datetime: (w.end_datetime as string) ?? null,
      })
    )

    return {
      success: true,
      output: {
        schedule: {
          standard_hours: schedule.standard_hours ?? [],
          maintenance_windows: maintenanceWindows,
        },
      },
    }
  },

  outputs: {
    schedule: {
      type: 'object',
      description: 'Exchange schedule (all times in ET)',
      properties: {
        standard_hours: {
          type: 'array',
          description: 'Weekly schedules with per-day open/close trading sessions',
        },
        maintenance_windows: {
          type: 'array',
          description: 'Scheduled maintenance windows with start_datetime and end_datetime',
        },
      },
    },
  },
}
