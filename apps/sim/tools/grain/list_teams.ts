import type { GrainListTeamsParams, GrainListTeamsResponse } from '@/tools/grain/types'
import type { ToolConfig } from '@/tools/types'

export const grainListTeamsTool: ToolConfig<GrainListTeamsParams, GrainListTeamsResponse> = {
  id: 'grain_list_teams',
  name: 'Grain List Teams',
  description: 'List all teams in the workspace',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Grain API key (Personal Access Token)',
    },
  },

  request: {
    url: 'https://api.grain.com/_/public-api/v2/teams',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
      'Public-Api-Version': '2025-10-31',
    }),
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
