import type { ToolConfig } from '@/tools/types'
import {
  UPTIMEROBOT_API_BASE,
  type UptimeRobotDeletePspParams,
  type UptimeRobotDeleteResponse,
  uptimeRobotError,
  uptimeRobotHeaders,
} from '@/tools/uptimerobot/types'

export const uptimeRobotDeletePspTool: ToolConfig<
  UptimeRobotDeletePspParams,
  UptimeRobotDeleteResponse
> = {
  id: 'uptimerobot_delete_psp',
  name: 'UptimeRobot Delete Status Page',
  description: 'Permanently delete an UptimeRobot public status page by ID',
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
      description: 'ID of the status page to delete',
    },
  },

  request: {
    url: (params) => `${UPTIMEROBOT_API_BASE}/psps/${params.pspId}`,
    method: 'DELETE',
    headers: (params) => uptimeRobotHeaders(params.apiKey),
  },

  transformResponse: async (response: Response, params?: UptimeRobotDeletePspParams) => {
    if (!response.ok) {
      throw new Error(await uptimeRobotError(response))
    }
    return {
      success: true,
      output: { deleted: true, id: params?.pspId ?? null },
    }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the status page was deleted' },
    id: { type: 'number', description: 'ID of the deleted status page', optional: true },
  },
}
