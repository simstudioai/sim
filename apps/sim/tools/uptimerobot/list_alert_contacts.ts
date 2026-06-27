import type { ToolConfig } from '@/tools/types'
import {
  ALERT_CONTACT_OUTPUT_PROPERTIES,
  mapAlertContact,
  UPTIMEROBOT_API_BASE,
  type UptimeRobotListAlertContactsParams,
  type UptimeRobotListAlertContactsResponse,
  uptimeRobotError,
  uptimeRobotHeaders,
} from '@/tools/uptimerobot/types'

export const uptimeRobotListAlertContactsTool: ToolConfig<
  UptimeRobotListAlertContactsParams,
  UptimeRobotListAlertContactsResponse
> = {
  id: 'uptimerobot_list_alert_contacts',
  name: 'UptimeRobot List Alert Contacts',
  description: 'List the personal alert contacts in your UptimeRobot account',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'UptimeRobot API key',
    },
    cursor: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor returned by a previous request',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.cursor != null) query.set('cursor', String(params.cursor))
      const qs = query.toString()
      return `${UPTIMEROBOT_API_BASE}/alert-contacts${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => uptimeRobotHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(await uptimeRobotError(response))
    }
    const data = await response.json()
    const contacts = Array.isArray(data?.data) ? data.data : []
    return {
      success: true,
      output: {
        alertContacts: contacts.map(mapAlertContact),
        nextLink: data?.nextLink ?? null,
      },
    }
  },

  outputs: {
    alertContacts: {
      type: 'array',
      description: 'List of alert contacts',
      items: { type: 'object', properties: ALERT_CONTACT_OUTPUT_PROPERTIES },
    },
    nextLink: {
      type: 'string',
      description: 'URL for the next page of results, or null on the last page',
      optional: true,
    },
  },
}
