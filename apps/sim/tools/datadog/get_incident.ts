import type { GetIncidentParams, GetIncidentResponse } from '@/tools/datadog/types'
import {
  datadogApiUrl,
  datadogErrorMessage,
  datadogHeaders,
  datadogPathSegment,
  splitCommaList,
} from '@/tools/datadog/utils'
import type { ToolConfig } from '@/tools/types'

export const getIncidentTool: ToolConfig<GetIncidentParams, GetIncidentResponse> = {
  id: 'datadog_get_incident',
  name: 'Datadog Get Incident',
  description:
    'Get the details of a single incident by ID. Requires the Incident Management `incident_read` permission; the Incidents API is in public beta.',
  version: '1.0.0',

  params: {
    incidentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The UUID of the incident (e.g., "00000000-0000-0000-1234-000000000000")',
    },
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated related resources to include (e.g., "users", "attachments")',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Datadog API key',
    },
    applicationKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Datadog Application key',
    },
    site: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Datadog site/region (default: datadoghq.com)',
    },
  },

  request: {
    url: (params) => {
      const include = splitCommaList(params.include)?.join(',')
      const queryString = include ? `?${new URLSearchParams({ include }).toString()}` : ''
      return datadogApiUrl(
        params.site,
        `/api/v2/incidents/${datadogPathSegment(params.incidentId)}${queryString}`
      )
    },
    method: 'GET',
    headers: datadogHeaders,
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      return {
        success: false,
        output: { incident: { id: '', attributes: {} } },
        error: await datadogErrorMessage(response),
      }
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        incident: {
          id: data.data?.id,
          type: data.data?.type,
          attributes: data.data?.attributes ?? {},
        },
      },
    }
  },

  outputs: {
    incident: {
      type: 'object',
      description: 'The incident',
      properties: {
        id: { type: 'string', description: 'Incident UUID' },
        type: { type: 'string', description: 'Resource type (incidents)' },
        attributes: {
          type: 'object',
          description: 'Incident attributes',
          properties: {
            title: { type: 'string', description: 'Incident title' },
            state: { type: 'string', description: 'Incident state' },
            severity: { type: 'string', description: 'Incident severity' },
            public_id: { type: 'number', description: 'Incremental public incident ID' },
            customer_impacted: { type: 'boolean', description: 'Whether customers were impacted' },
            customer_impact_scope: {
              type: 'string',
              description: 'Summary of the customer impact',
            },
            created: { type: 'string', description: 'Creation timestamp' },
            modified: { type: 'string', description: 'Last modification timestamp' },
            resolved: { type: 'string', description: 'Resolution timestamp' },
            time_to_resolve: { type: 'number', description: 'Seconds from creation to resolution' },
          },
        },
      },
    },
  },
}
