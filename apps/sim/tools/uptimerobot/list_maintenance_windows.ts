import type { ToolConfig } from '@/tools/types'
import {
  MAINTENANCE_WINDOW_OUTPUT_PROPERTIES,
  mapMaintenanceWindow,
  UPTIMEROBOT_API_BASE,
  type UptimeRobotListMaintenanceWindowsParams,
  type UptimeRobotListMaintenanceWindowsResponse,
  uptimeRobotError,
  uptimeRobotHeaders,
} from '@/tools/uptimerobot/types'

export const uptimeRobotListMaintenanceWindowsTool: ToolConfig<
  UptimeRobotListMaintenanceWindowsParams,
  UptimeRobotListMaintenanceWindowsResponse
> = {
  id: 'uptimerobot_list_maintenance_windows',
  name: 'UptimeRobot List Maintenance Windows',
  description: 'List maintenance windows in your UptimeRobot account',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'UptimeRobot API key',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor returned by a previous request',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.cursor) query.set('cursor', params.cursor)
      const qs = query.toString()
      return `${UPTIMEROBOT_API_BASE}/maintenance-windows${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => uptimeRobotHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(await uptimeRobotError(response))
    }
    const data = await response.json()
    const windows = Array.isArray(data?.data) ? data.data : []
    return {
      success: true,
      output: {
        maintenanceWindows: windows.map(mapMaintenanceWindow),
        nextLink: data?.nextLink ?? null,
      },
    }
  },

  outputs: {
    maintenanceWindows: {
      type: 'array',
      description: 'List of maintenance windows',
      items: { type: 'object', properties: MAINTENANCE_WINDOW_OUTPUT_PROPERTIES },
    },
    nextLink: {
      type: 'string',
      description: 'URL for the next page of results, or null on the last page',
      optional: true,
    },
  },
}
