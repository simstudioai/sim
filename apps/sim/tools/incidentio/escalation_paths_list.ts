import type {
  IncidentioEscalationPathsListParams,
  IncidentioEscalationPathsListResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const escalationPathsListTool: ToolConfig<
  IncidentioEscalationPathsListParams,
  IncidentioEscalationPathsListResponse
> = {
  id: 'incidentio_escalation_paths_list',
  name: 'List Escalation Paths',
  description: 'List escalation paths in incident.io',
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
      visibility: 'user-or-llm',
      description: 'Number of escalation paths to return per page',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor to fetch the next page of results',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.incident.io/v2/escalation_paths')
      if (params.page_size) url.searchParams.set('page_size', params.page_size.toString())
      if (params.after) url.searchParams.set('after', params.after)
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
        escalation_paths: data.escalation_paths ?? [],
        pagination_meta: data.pagination_meta
          ? {
              after: data.pagination_meta.after,
              page_size: data.pagination_meta.page_size,
            }
          : undefined,
      },
    }
  },

  outputs: {
    escalation_paths: {
      type: 'array',
      description: 'List of escalation paths',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The escalation path ID' },
          name: { type: 'string', description: 'The escalation path name' },
          path: { type: 'array', description: 'Array of escalation levels' },
          working_hours: {
            type: 'array',
            description: 'Working hours configuration',
            optional: true,
          },
        },
      },
    },
    pagination_meta: {
      type: 'object',
      description: 'Pagination metadata',
      optional: true,
      properties: {
        after: { type: 'string', description: 'Cursor for next page', optional: true },
        page_size: { type: 'number', description: 'Number of results per page' },
      },
    },
  },
}
