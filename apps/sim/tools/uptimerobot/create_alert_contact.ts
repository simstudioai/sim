import type { ToolConfig } from '@/tools/types'
import {
  ALERT_CONTACT_OUTPUT_PROPERTIES,
  mapAlertContact,
  UPTIMEROBOT_API_BASE,
  type UptimeRobotAlertContactResponse,
  type UptimeRobotCreateAlertContactParams,
  uptimeRobotError,
  uptimeRobotHeaders,
} from '@/tools/uptimerobot/types'

export const uptimeRobotCreateAlertContactTool: ToolConfig<
  UptimeRobotCreateAlertContactParams,
  UptimeRobotAlertContactResponse
> = {
  id: 'uptimerobot_create_alert_contact',
  name: 'UptimeRobot Create Alert Contact',
  description:
    'Create an email alert contact in UptimeRobot. The contact must be confirmed via email before it can receive alerts.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'UptimeRobot API key',
    },
    value: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email address for the alert contact',
    },
    friendlyName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Display name for the alert contact',
    },
    enableNotificationsFor: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Which monitor events to notify for: 0, 1, 2, or 3',
    },
  },

  request: {
    url: () => `${UPTIMEROBOT_API_BASE}/alert-contacts`,
    method: 'POST',
    headers: (params) => ({
      ...uptimeRobotHeaders(params.apiKey),
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        type: 'Email',
        value: params.value,
      }
      if (params.friendlyName) body.friendlyName = params.friendlyName
      if (params.enableNotificationsFor != null) {
        body.enableNotificationsFor = params.enableNotificationsFor
      }
      return body
    },
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
      description: 'The created alert contact',
      properties: ALERT_CONTACT_OUTPUT_PROPERTIES,
    },
  },
}
