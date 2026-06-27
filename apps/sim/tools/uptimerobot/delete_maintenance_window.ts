import type { ToolConfig } from '@/tools/types'
import {
  UPTIMEROBOT_API_BASE,
  type UptimeRobotDeleteMaintenanceWindowParams,
  type UptimeRobotDeleteResponse,
  uptimeRobotError,
  uptimeRobotHeaders,
} from '@/tools/uptimerobot/types'

export const uptimeRobotDeleteMaintenanceWindowTool: ToolConfig<
  UptimeRobotDeleteMaintenanceWindowParams,
  UptimeRobotDeleteResponse
> = {
  id: 'uptimerobot_delete_maintenance_window',
  name: 'UptimeRobot Delete Maintenance Window',
  description: 'Permanently delete an UptimeRobot maintenance window by ID',
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
      description: 'ID of the maintenance window to delete',
    },
  },

  request: {
    url: (params) => `${UPTIMEROBOT_API_BASE}/maintenance-windows/${params.maintenanceWindowId}`,
    method: 'DELETE',
    headers: (params) => uptimeRobotHeaders(params.apiKey),
  },

  transformResponse: async (
    response: Response,
    params?: UptimeRobotDeleteMaintenanceWindowParams
  ) => {
    if (!response.ok) {
      throw new Error(await uptimeRobotError(response))
    }
    return {
      success: true,
      output: { deleted: true, id: params?.maintenanceWindowId ?? null },
    }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the maintenance window was deleted' },
    id: { type: 'number', description: 'ID of the deleted maintenance window', optional: true },
  },
}
