import type { ToolConfig } from '@/tools/types'
import {
  UPTIMEROBOT_API_BASE,
  type UptimeRobotDeleteAlertContactParams,
  type UptimeRobotDeleteResponse,
  uptimeRobotError,
  uptimeRobotHeaders,
} from '@/tools/uptimerobot/types'

export const uptimeRobotDeleteAlertContactTool: ToolConfig<
  UptimeRobotDeleteAlertContactParams,
  UptimeRobotDeleteResponse
> = {
  id: 'uptimerobot_delete_alert_contact',
  name: 'UptimeRobot Delete Alert Contact',
  description: 'Permanently delete an UptimeRobot alert contact by ID',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'UptimeRobot API key',
    },
    alertContactId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the alert contact to delete',
    },
  },

  request: {
    url: (params) => `${UPTIMEROBOT_API_BASE}/alert-contacts/${params.alertContactId}`,
    method: 'DELETE',
    headers: (params) => uptimeRobotHeaders(params.apiKey),
  },

  transformResponse: async (response: Response, params?: UptimeRobotDeleteAlertContactParams) => {
    if (!response.ok) {
      throw new Error(await uptimeRobotError(response))
    }
    return {
      success: true,
      output: { deleted: true, id: params?.alertContactId ?? null },
    }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the alert contact was deleted' },
    id: { type: 'number', description: 'ID of the deleted alert contact', optional: true },
  },
}
