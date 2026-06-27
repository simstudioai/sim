import type { ToolConfig } from '@/tools/types'
import {
  ACCOUNT_OUTPUT_PROPERTIES,
  mapAccount,
  UPTIMEROBOT_API_BASE,
  type UptimeRobotAccountResponse,
  type UptimeRobotGetAccountParams,
  uptimeRobotError,
  uptimeRobotHeaders,
} from '@/tools/uptimerobot/types'

export const uptimeRobotGetAccountTool: ToolConfig<
  UptimeRobotGetAccountParams,
  UptimeRobotAccountResponse
> = {
  id: 'uptimerobot_get_account',
  name: 'UptimeRobot Get Account',
  description: 'Get details about the authenticated UptimeRobot account, including plan and limits',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'UptimeRobot API key',
    },
  },

  request: {
    url: () => `${UPTIMEROBOT_API_BASE}/user/me`,
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
      output: { account: mapAccount(data) },
    }
  },

  outputs: {
    account: {
      type: 'object',
      description: 'The account details',
      properties: ACCOUNT_OUTPUT_PROPERTIES,
    },
  },
}
