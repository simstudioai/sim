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

export const uptimeRobotStartMonitorTool: ToolConfig<
  UptimeRobotGetMonitorParams,
  UptimeRobotMonitorResponse
> = {
  id: 'uptimerobot_start_monitor',
  name: 'UptimeRobot Start Monitor',
  description: 'Resume a paused UptimeRobot monitor so it starts running checks again',
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
      description: 'ID of the monitor to start',
    },
  },

  request: {
    url: (params) => `${UPTIMEROBOT_API_BASE}/monitors/${params.monitorId}/start`,
    method: 'POST',
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
      description: 'The started monitor',
      properties: MONITOR_OUTPUT_PROPERTIES,
    },
  },
}
