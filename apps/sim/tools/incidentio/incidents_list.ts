import type {
  IncidentioIncidentsListParams,
  IncidentioIncidentsListResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const incidentsListTool: ToolConfig<
  IncidentioIncidentsListParams,
  IncidentioIncidentsListResponse
> = {
  id: 'incidentio_incidents_list',
  name: 'incident.io Incidents List',
  description:
    'List incidents from incident.io. Returns a list of incidents with their details including severity, status, and timestamps.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'incident.io API Key',
    },
    page_size: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Number of incidents to return per page (default: 25)',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Pagination cursor to fetch the next page of results',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.incident.io/v2/incidents')

      if (params.page_size) {
        url.searchParams.append('page_size', params.page_size.toString())
      }

      if (params.after) {
        url.searchParams.append('after', params.after)
      }

      return url.toString()
    },
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
        incidents:
          data.incidents?.map((incident: any) => ({
            id: incident.id,
            name: incident.name,
            summary: incident.summary,
            description: incident.description,
            mode: incident.mode,
            call_url: incident.call_url,
            severity: incident.severity
              ? {
                  id: incident.severity.id,
                  name: incident.severity.name,
                  rank: incident.severity.rank,
                }
              : undefined,
            status: incident.incident_status
              ? {
                  id: incident.incident_status.id,
                  name: incident.incident_status.name,
                  category: incident.incident_status.category,
                }
              : undefined,
            incident_type: incident.incident_type
              ? {
                  id: incident.incident_type.id,
                  name: incident.incident_type.name,
                }
              : undefined,
            created_at: incident.created_at,
            updated_at: incident.updated_at,
            incident_url: incident.incident_url,
            slack_channel_id: incident.slack_channel_id,
            slack_channel_name: incident.slack_channel_name,
            visibility: incident.visibility,
          })) || [],
        pagination_meta: data.pagination_meta
          ? {
              after: data.pagination_meta.after,
              page_size: data.pagination_meta.page_size,
              total_record_count: data.pagination_meta.total_record_count,
            }
          : undefined,
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
          id: { type: 'string', description: 'Incident ID' },
          name: { type: 'string', description: 'Incident name' },
          summary: { type: 'string', description: 'Brief summary of the incident' },
          description: { type: 'string', description: 'Detailed description of the incident' },
          mode: { type: 'string', description: 'Incident mode (e.g., standard, retrospective)' },
          call_url: { type: 'string', description: 'URL for the incident call/bridge' },
          severity: {
            type: 'object',
            description: 'Severity of the incident',
            properties: {
              id: { type: 'string', description: 'Severity ID' },
              name: { type: 'string', description: 'Severity name' },
              rank: { type: 'number', description: 'Severity rank' },
            },
          },
          status: {
            type: 'object',
            description: 'Current status of the incident',
            properties: {
              id: { type: 'string', description: 'Status ID' },
              name: { type: 'string', description: 'Status name' },
              category: { type: 'string', description: 'Status category' },
            },
          },
          incident_type: {
            type: 'object',
            description: 'Type of the incident',
            properties: {
              id: { type: 'string', description: 'Type ID' },
              name: { type: 'string', description: 'Type name' },
            },
          },
          created_at: { type: 'string', description: 'Creation timestamp' },
          updated_at: { type: 'string', description: 'Last update timestamp' },
          incident_url: { type: 'string', description: 'URL to the incident' },
          slack_channel_id: { type: 'string', description: 'Associated Slack channel ID' },
          slack_channel_name: { type: 'string', description: 'Associated Slack channel name' },
          visibility: { type: 'string', description: 'Incident visibility' },
        },
      },
    },
    pagination_meta: {
      type: 'object',
      description: 'Pagination metadata',
      optional: true,
      properties: {
        after: { type: 'string', description: 'Cursor for the next page', optional: true },
        page_size: { type: 'number', description: 'Number of items per page' },
        total_record_count: {
          type: 'number',
          description: 'Total number of records available',
          optional: true,
        },
      },
    },
  },
}
