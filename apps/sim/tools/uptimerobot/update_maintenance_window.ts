import type { ToolConfig } from '@/tools/types'
import {
  buildMaintenanceWindowBody,
  MAINTENANCE_WINDOW_OUTPUT_PROPERTIES,
  mapMaintenanceWindow,
  UPTIMEROBOT_API_BASE,
  type UptimeRobotMaintenanceWindowResponse,
  type UptimeRobotUpdateMaintenanceWindowParams,
  uptimeRobotError,
  uptimeRobotHeaders,
} from '@/tools/uptimerobot/types'

export const uptimeRobotUpdateMaintenanceWindowTool: ToolConfig<
  UptimeRobotUpdateMaintenanceWindowParams,
  UptimeRobotMaintenanceWindowResponse
> = {
  id: 'uptimerobot_update_maintenance_window',
  name: 'UptimeRobot Update Maintenance Window',
  description: 'Update an existing maintenance window. Only the provided fields are changed.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'UptimeRobot API key',
    },
    maintenanceWindowId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the maintenance window to update',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New name of the maintenance window',
    },
    interval: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Recurrence interval: once, daily, weekly, or monthly',
    },
    date: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start date in YYYY-MM-DD format',
    },
    time: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start time in HH:mm:ss format',
    },
    duration: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Duration in minutes (minimum 1)',
    },
    days: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated days for weekly (1-7) or monthly (day-of-month, -1 for last day) windows',
    },
    monitorIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated monitor IDs to assign to the window',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set to "active" to enable or "paused" to disable the maintenance window',
    },
  },

  request: {
    url: (params) => `${UPTIMEROBOT_API_BASE}/maintenance-windows/${params.maintenanceWindowId}`,
    method: 'PATCH',
    headers: (params) => ({
      ...uptimeRobotHeaders(params.apiKey),
      'Content-Type': 'application/json',
    }),
    body: (params) => buildMaintenanceWindowBody(params),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(await uptimeRobotError(response))
    }
    const data = await response.json()
    return {
      success: true,
      output: { maintenanceWindow: mapMaintenanceWindow(data) },
    }
  },

  outputs: {
    maintenanceWindow: {
      type: 'object',
      description: 'The updated maintenance window',
      properties: MAINTENANCE_WINDOW_OUTPUT_PROPERTIES,
    },
  },
}
