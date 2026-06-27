import type { ToolConfig } from '@/tools/types'
import {
  MAINTENANCE_WINDOW_OUTPUT_PROPERTIES,
  mapMaintenanceWindow,
  UPTIMEROBOT_API_BASE,
  type UptimeRobotGetMaintenanceWindowParams,
  type UptimeRobotMaintenanceWindowResponse,
  uptimeRobotError,
  uptimeRobotHeaders,
} from '@/tools/uptimerobot/types'

export const uptimeRobotGetMaintenanceWindowTool: ToolConfig<
  UptimeRobotGetMaintenanceWindowParams,
  UptimeRobotMaintenanceWindowResponse
> = {
  id: 'uptimerobot_get_maintenance_window',
  name: 'UptimeRobot Get Maintenance Window',
  description: 'Get the details of a single UptimeRobot maintenance window by ID',
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
      description: 'ID of the maintenance window to retrieve',
    },
  },

  request: {
    url: (params) => `${UPTIMEROBOT_API_BASE}/maintenance-windows/${params.maintenanceWindowId}`,
    method: 'GET',
    headers: (params) => uptimeRobotHeaders(params.apiKey),
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
      description: 'The maintenance window details',
      properties: MAINTENANCE_WINDOW_OUTPUT_PROPERTIES,
    },
  },
}
