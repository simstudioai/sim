import type { GrainListTeamsParams, GrainListTeamsResponse } from '@/tools/grain/types'
import type { ToolConfig } from '@/tools/types'

export const grainListTeamsTool: ToolConfig<GrainListTeamsParams, GrainListTeamsResponse> = {
  id: 'grain_list_teams',
  name: 'Grain List Teams',
  description: 'List all teams in the workspace',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'grain',
  },

  params: {
    accessToken: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'OAuth access token (auto-injected)',
    },
  },

  request: {
    url: 'https://api.grain.com/_/public-api/v2/teams',
    method: 'GET',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Missing access token for Grain API request')
      }
      return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
        'Public-Api-Version': '2025-10-31',
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || data.message || 'Failed to list teams')
    }

    return {
      success: true,
      output: {
        teams: data.teams || data || [],
      },
    }
  },

  outputs: {
    teams: {
      type: 'array',
      description: 'Array of team objects',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Team UUID' },
          name: { type: 'string', description: 'Team name' },
        },
      },
    },
  },
}
