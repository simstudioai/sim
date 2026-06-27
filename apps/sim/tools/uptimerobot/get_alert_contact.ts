import type { ToolConfig } from '@/tools/types'
import {
  ALERT_CONTACT_OUTPUT_PROPERTIES,
  mapAlertContact,
  UPTIMEROBOT_API_BASE,
  type UptimeRobotAlertContactResponse,
  type UptimeRobotGetAlertContactParams,
  uptimeRobotError,
  uptimeRobotHeaders,
} from '@/tools/uptimerobot/types'

export const uptimeRobotGetAlertContactTool: ToolConfig<
  UptimeRobotGetAlertContactParams,
  UptimeRobotAlertContactResponse
> = {
  id: 'uptimerobot_get_alert_contact',
  name: 'UptimeRobot Get Alert Contact',
  description: 'Get the details of a single UptimeRobot alert contact by ID',
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
      description: 'ID of the alert contact to retrieve',
    },
  },

  request: {
    url: (params) => `${UPTIMEROBOT_API_BASE}/alert-contacts/${params.alertContactId}`,
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
      output: { alertContact: mapAlertContact(data) },
    }
  },

  outputs: {
    alertContact: {
      type: 'object',
      description: 'The alert contact details',
      properties: ALERT_CONTACT_OUTPUT_PROPERTIES,
    },
  },
}
