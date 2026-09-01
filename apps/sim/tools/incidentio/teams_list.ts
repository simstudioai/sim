import {
  INCIDENTIO_TEAM_OUTPUT_PROPERTIES,
  type IncidentioTeamsListParams,
  type IncidentioTeamsListResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const teamsListTool: ToolConfig<IncidentioTeamsListParams, IncidentioTeamsListResponse> = {
  id: 'incidentio_teams_list',
  name: 'List Teams',
  description: 'List all teams in the incident.io organisation, along with their members',
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
      description: 'Number of results per page (e.g., 10, 25, 50)',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Pagination cursor to fetch the next page of results (e.g., "01FCNDV6P870EA6S7TK1DSYDG0")',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.incident.io/v3/teams')
      if (params.page_size) url.searchParams.set('page_size', String(params.page_size))
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
        teams: data.teams ?? [],
        pagination_meta: data.pagination_meta,
      },
    }
  },

  outputs: {
    teams: {
      type: 'array',
      description: 'List of teams',
      items: {
        type: 'object',
        properties: INCIDENTIO_TEAM_OUTPUT_PROPERTIES,
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
