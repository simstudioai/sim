import type {
  IncidentioEscalationsListParams,
  IncidentioEscalationsListResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const escalationsListTool: ToolConfig<
  IncidentioEscalationsListParams,
  IncidentioEscalationsListResponse
> = {
  id: 'incidentio_escalations_list',
  name: 'List Escalations',
  description: 'List all escalation policies in incident.io',
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
      description: 'Number of escalations to return per page',
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
      const url = new URL('https://api.incident.io/v2/escalations')
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
        escalations: data.escalations || [],
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
    escalations: {
      type: 'array',
      description: 'List of escalation policies',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The escalation policy ID' },
          name: { type: 'string', description: 'The escalation policy name' },
          created_at: { type: 'string', description: 'When the escalation policy was created' },
          updated_at: {
            type: 'string',
            description: 'When the escalation policy was last updated',
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
