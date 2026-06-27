import type { ToolConfig } from '@/tools/types'
import {
  mapPsp,
  PSP_OUTPUT_PROPERTIES,
  UPTIMEROBOT_API_BASE,
  type UptimeRobotGetPspParams,
  type UptimeRobotPspResponse,
  uptimeRobotError,
  uptimeRobotHeaders,
} from '@/tools/uptimerobot/types'

export const uptimeRobotGetPspTool: ToolConfig<UptimeRobotGetPspParams, UptimeRobotPspResponse> = {
  id: 'uptimerobot_get_psp',
  name: 'UptimeRobot Get Status Page',
  description: 'Get the details of a single UptimeRobot public status page by ID',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'UptimeRobot API key',
    },
    pspId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the status page to retrieve',
    },
  },

  request: {
    url: (params) => `${UPTIMEROBOT_API_BASE}/psps/${params.pspId}`,
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
      output: { psp: mapPsp(data) },
    }
  },

  outputs: {
    psp: {
      type: 'object',
      description: 'The status page details',
      properties: PSP_OUTPUT_PROPERTIES,
    },
  },
}
