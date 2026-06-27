import type { ToolConfig } from '@/tools/types'
import {
  INCIDENT_DETAIL_OUTPUT_PROPERTIES,
  mapIncidentDetail,
  UPTIMEROBOT_API_BASE,
  type UptimeRobotGetIncidentParams,
  type UptimeRobotIncidentResponse,
  uptimeRobotError,
  uptimeRobotHeaders,
} from '@/tools/uptimerobot/types'

export const uptimeRobotGetIncidentTool: ToolConfig<
  UptimeRobotGetIncidentParams,
  UptimeRobotIncidentResponse
> = {
  id: 'uptimerobot_get_incident',
  name: 'UptimeRobot Get Incident',
  description: 'Get the details of a single UptimeRobot incident by ID',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'UptimeRobot API key',
    },
    incidentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the incident to retrieve',
    },
  },

  request: {
    url: (params) =>
      `${UPTIMEROBOT_API_BASE}/incidents/${encodeURIComponent(params.incidentId.trim())}`,
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
      output: { incident: mapIncidentDetail(data) },
    }
  },

  outputs: {
    incident: {
      type: 'object',
      description: 'The incident details',
      properties: INCIDENT_DETAIL_OUTPUT_PROPERTIES,
    },
  },
}
