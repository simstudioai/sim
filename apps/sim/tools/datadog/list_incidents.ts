import type {
  DatadogV2Resource,
  IncidentAttributes,
  ListIncidentsParams,
  ListIncidentsResponse,
} from '@/tools/datadog/types'
import {
  datadogApiUrl,
  datadogErrorMessage,
  datadogHeaders,
  splitCommaList,
} from '@/tools/datadog/utils'
import type { ToolConfig } from '@/tools/types'

export const listIncidentsTool: ToolConfig<ListIncidentsParams, ListIncidentsResponse> = {
  id: 'datadog_list_incidents',
  name: 'Datadog List Incidents',
  description:
    'List incidents for the organization. Requires the Incident Management `incident_read` permission; the Incidents API is in public beta.',
  version: '1.0.0',

  params: {
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated related resources to include: "users" and/or "attachments"',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of incidents to return per page (default: 10, max: 100)',
    },
    pageOffset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Index of the first incident to return (e.g., 0, 10, 20)',
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
      const queryParams = new URLSearchParams()
      const include = splitCommaList(params.include)?.join(',')
      if (include) queryParams.set('include', include)
      if (params.pageSize !== undefined) queryParams.set('page[size]', String(params.pageSize))
      if (params.pageOffset !== undefined)
        queryParams.set('page[offset]', String(params.pageOffset))
      const queryString = queryParams.toString()
      return datadogApiUrl(params.site, `/api/v2/incidents${queryString ? `?${queryString}` : ''}`)
    },
    method: 'GET',
    headers: datadogHeaders,
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      return {
        success: false,
        output: { incidents: [] },
        error: await datadogErrorMessage(response),
      }
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        incidents: (data.data ?? []).map((incident: DatadogV2Resource<IncidentAttributes>) => ({
          id: incident.id,
          type: incident.type,
          attributes: incident.attributes ?? {},
        })),
        nextOffset: data.meta?.pagination?.next_offset,
      },
    }
  },

  outputs: {
    incidents: {
      type: 'array',
      description: 'List of incidents',
      items: {
        type: 'object',
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
              customer_impacted: {
                type: 'boolean',
                description: 'Whether customers were impacted',
              },
              created: { type: 'string', description: 'Creation timestamp' },
              modified: { type: 'string', description: 'Last modification timestamp' },
              resolved: { type: 'string', description: 'Resolution timestamp' },
            },
          },
        },
      },
    },
    nextOffset: {
      type: 'number',
      description: 'Offset to use for the next page of results',
      optional: true,
    },
  },
}
