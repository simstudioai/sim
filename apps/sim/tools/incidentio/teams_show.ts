import {
  INCIDENTIO_TEAM_OUTPUT_PROPERTIES,
  type IncidentioTeamsShowParams,
  type IncidentioTeamsShowResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const teamsShowTool: ToolConfig<IncidentioTeamsShowParams, IncidentioTeamsShowResponse> = {
  id: 'incidentio_teams_show',
  name: 'Show Team',
  description: 'Get a single team by ID from incident.io, along with its members',
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
      description: 'The ID of the team to fetch (e.g., "01JPQA75EPNEES4479P16P4XAB")',
    },
  },

  request: {
    url: (params) => `https://api.incident.io/v3/teams/${safeUrlPathSegment(params.id, 'id')}`,
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
        team: data.team,
      },
    }
  },

  outputs: {
    team: {
      type: 'object',
      description: 'The team details',
      properties: INCIDENTIO_TEAM_OUTPUT_PROPERTIES,
    },
  },
}
