import type { LinearGetActiveCycleParams, LinearGetActiveCycleResponse } from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearGetActiveCycleTool: ToolConfig<
  LinearGetActiveCycleParams,
  LinearGetActiveCycleResponse
> = {
  id: 'linear_get_active_cycle',
  name: 'Linear Get Active Cycle',
  description: 'Get the currently active cycle for a team',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'linear',
  },

  params: {
    teamId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Team ID',
    },
  },

  request: {
    url: 'https://api.linear.app/graphql',
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Missing access token for Linear API request')
      }
      return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
    body: (params) => ({
      query: `
        query GetActiveCycle($id: String!) {
          team(id: $id) {
            activeCycle {
              id
              number
              name
              startsAt
              endsAt
              completedAt
              progress
              team {
                id
                name
              }
            }
          }
        }
      `,
      variables: {
        id: params.teamId,
      },
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to fetch active cycle',
        output: {},
      }
    }

    return {
      success: true,
      output: {
        cycle: data.data.team.activeCycle || null,
      },
    }
  },

  outputs: {
    cycle: {
      type: 'object',
      description: 'The active cycle (null if no active cycle)',
      properties: {
        id: { type: 'string', description: 'Cycle ID' },
        number: { type: 'number', description: 'Cycle number' },
        name: { type: 'string', description: 'Cycle name' },
        startsAt: { type: 'string', description: 'Start date' },
        endsAt: { type: 'string', description: 'End date' },
        progress: { type: 'number', description: 'Progress percentage' },
        team: { type: 'object', description: 'Team this cycle belongs to' },
      },
    },
  },
}
