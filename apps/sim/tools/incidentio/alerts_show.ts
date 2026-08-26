import {
  INCIDENTIO_ALERT_OUTPUT_PROPERTIES,
  type IncidentioAlertsShowParams,
  type IncidentioAlertsShowResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const alertsShowTool: ToolConfig<IncidentioAlertsShowParams, IncidentioAlertsShowResponse> =
  {
    id: 'incidentio_alerts_show',
    name: 'Show Alert',
    description: 'Get a single alert by ID from incident.io',
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
        description: 'The ID of the alert to fetch (e.g., "01GW2G3V0S59R238FAHPDS1R66")',
      },
    },

    request: {
      url: (params) => `https://api.incident.io/v2/alerts/${safeUrlPathSegment(params.id, 'id')}`,
      method: 'GET',
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
        description: 'The alert details',
        properties: INCIDENTIO_ALERT_OUTPUT_PROPERTIES,
      },
    },
  }
