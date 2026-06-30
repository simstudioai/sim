import type { ToolConfig } from '@/tools/types'
import {
  MONITOR_OUTPUT_PROPERTIES,
  mapMonitor,
  UPTIMEROBOT_API_BASE,
  type UptimeRobotGetMonitorParams,
  type UptimeRobotMonitorResponse,
  uptimeRobotError,
  uptimeRobotHeaders,
} from '@/tools/uptimerobot/types'

export const uptimeRobotGetMonitorTool: ToolConfig<
  UptimeRobotGetMonitorParams,
  UptimeRobotMonitorResponse
> = {
  id: 'uptimerobot_get_monitor',
  name: 'UptimeRobot Get Monitor',
  description: 'Get the details of a single UptimeRobot monitor by ID',
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
      description: 'ID of the monitor to retrieve',
    },
  },

  request: {
    url: (params) => `${UPTIMEROBOT_API_BASE}/monitors/${params.monitorId}`,
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
      output: { monitor: mapMonitor(data) },
    }
  },

  outputs: {
    monitor: {
      type: 'object',
      description: 'The monitor details',
      properties: MONITOR_OUTPUT_PROPERTIES,
    },
  },
}
