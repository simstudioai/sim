import type {
  IncidentioIncidentUpdatesListParams,
  IncidentioIncidentUpdatesListResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const incidentUpdatesListTool: ToolConfig<
  IncidentioIncidentUpdatesListParams,
  IncidentioIncidentUpdatesListResponse
> = {
  id: 'incidentio_incident_updates_list',
  name: 'List Incident Updates',
  description: 'List all updates for a specific incident in incident.io',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'incident.io API Key',
    },
    incident_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The ID of the incident to get updates for (e.g., "01FCNDV6P870EA6S7TK1DSYDG0"). If not provided, returns all updates',
    },
    page_size: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return per page (e.g., 10, 25, 50)',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor for pagination (e.g., "01FCNDV6P870EA6S7TK1DSYDG0")',
    },
  },

  request: {
    url: (params) => {
      const queryParams: string[] = []

      if (params.incident_id) {
        queryParams.push(`incident_id=${params.incident_id}`)
      }

      if (params.page_size) {
        queryParams.push(`page_size=${params.page_size}`)
      }

      if (params.after) {
        queryParams.push(`after=${params.after}`)
      }

      const queryString = queryParams.length > 0 ? `?${queryParams.join('&')}` : ''
      return `https://api.incident.io/v2/incident_updates${queryString}`
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
        incident_updates: data.incident_updates || data,
        pagination_meta: data.pagination_meta,
      },
    }
  },

  outputs: {
    incident_updates: {
      type: 'array',
      description: 'List of incident updates',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The update ID' },
          incident_id: { type: 'string', description: 'The incident ID' },
          message: { type: 'string', description: 'The update message' },
          new_severity: {
            type: 'object',
            description: 'New severity if changed',
            optional: true,
            properties: {
              id: { type: 'string', description: 'Severity ID' },
              name: { type: 'string', description: 'Severity name' },
              rank: { type: 'number', description: 'Severity rank' },
            },
          },
          new_status: {
            type: 'object',
            description: 'New status if changed',
            optional: true,
            properties: {
              id: { type: 'string', description: 'Status ID' },
              name: { type: 'string', description: 'Status name' },
              category: { type: 'string', description: 'Status category' },
            },
          },
          updater: {
            type: 'object',
            description: 'User who created the update',
            properties: {
              id: { type: 'string', description: 'User ID' },
              name: { type: 'string', description: 'User name' },
              email: { type: 'string', description: 'User email' },
            },
          },
          created_at: { type: 'string', description: 'When the update was created' },
          updated_at: { type: 'string', description: 'When the update was last modified' },
        },
      },
    },
    pagination_meta: {
      type: 'object',
      description: 'Pagination information',
      optional: true,
      properties: {
        after: { type: 'string', description: 'Cursor for next page', optional: true },
        page_size: { type: 'number', description: 'Number of results per page' },
      },
    },
  },
}
