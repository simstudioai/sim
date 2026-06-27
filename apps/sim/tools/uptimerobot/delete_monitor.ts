import type { ToolConfig } from '@/tools/types'
import {
  UPTIMEROBOT_API_BASE,
  type UptimeRobotDeleteMonitorParams,
  type UptimeRobotDeleteResponse,
  uptimeRobotError,
  uptimeRobotHeaders,
} from '@/tools/uptimerobot/types'

export const uptimeRobotDeleteMonitorTool: ToolConfig<
  UptimeRobotDeleteMonitorParams,
  UptimeRobotDeleteResponse
> = {
  id: 'uptimerobot_delete_monitor',
  name: 'UptimeRobot Delete Monitor',
  description: 'Permanently delete an UptimeRobot monitor by ID',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'UptimeRobot API key',
    },
    monitorId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the monitor to delete',
    },
  },

  request: {
    url: (params) => `${UPTIMEROBOT_API_BASE}/monitors/${params.monitorId}`,
    method: 'DELETE',
    headers: (params) => uptimeRobotHeaders(params.apiKey),
  },

  transformResponse: async (response: Response, params?: UptimeRobotDeleteMonitorParams) => {
    if (!response.ok) {
      throw new Error(await uptimeRobotError(response))
    }
    return {
      success: true,
      output: { deleted: true, id: params?.monitorId ?? null },
    }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the monitor was deleted' },
    id: { type: 'number', description: 'ID of the deleted monitor', optional: true },
  },
}
