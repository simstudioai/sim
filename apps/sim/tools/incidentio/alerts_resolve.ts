import {
  INCIDENTIO_ALERT_OUTPUT_PROPERTIES,
  type IncidentioAlertsResolveParams,
  type IncidentioAlertsResolveResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const alertsResolveTool: ToolConfig<
  IncidentioAlertsResolveParams,
  IncidentioAlertsResolveResponse
> = {
  id: 'incidentio_alerts_resolve',
  name: 'Resolve Alert',
  description:
    'Resolve a currently firing alert in incident.io. Resolving an already-resolved alert is a no-op and returns it unchanged.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'incident.io API Key',
    },
    id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the alert to resolve (e.g., "01GW2G3V0S59R238FAHPDS1R66")',
    },
  },

  request: {
    url: (params) =>
      `https://api.incident.io/v2/alerts/${encodeURIComponent(params.id.trim())}/actions/resolve`,
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        alert: data.alert,
      },
    }
  },

  outputs: {
    alert: {
      type: 'object',
      description: 'The resolved alert',
      properties: INCIDENTIO_ALERT_OUTPUT_PROPERTIES,
    },
  },
}
