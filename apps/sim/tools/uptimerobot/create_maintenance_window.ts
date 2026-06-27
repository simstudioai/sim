import type { ToolConfig } from '@/tools/types'
import {
  buildMaintenanceWindowBody,
  MAINTENANCE_WINDOW_OUTPUT_PROPERTIES,
  mapMaintenanceWindow,
  UPTIMEROBOT_API_BASE,
  type UptimeRobotCreateMaintenanceWindowParams,
  type UptimeRobotMaintenanceWindowResponse,
  uptimeRobotError,
  uptimeRobotHeaders,
} from '@/tools/uptimerobot/types'

export const uptimeRobotCreateMaintenanceWindowTool: ToolConfig<
  UptimeRobotCreateMaintenanceWindowParams,
  UptimeRobotMaintenanceWindowResponse
> = {
  id: 'uptimerobot_create_maintenance_window',
  name: 'UptimeRobot Create Maintenance Window',
  description: 'Create a new maintenance window to suppress alerts during planned downtime',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'UptimeRobot API key',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the maintenance window',
    },
    interval: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Recurrence interval: once, daily, weekly, or monthly',
    },
    date: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Start date in YYYY-MM-DD format',
    },
    time: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Start time in HH:mm:ss format',
    },
    duration: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Duration in minutes (minimum 1)',
    },
    autoAddMonitors: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to automatically add all monitors to this window',
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
  },

  request: {
    url: () => `${UPTIMEROBOT_API_BASE}/maintenance-windows`,
    method: 'POST',
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
      description: 'The created maintenance window',
      properties: MAINTENANCE_WINDOW_OUTPUT_PROPERTIES,
    },
  },
}
