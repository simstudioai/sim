import type { LinearGetCycleParams, LinearGetCycleResponse } from '@/tools/linear/types'
import { CYCLE_FULL_OUTPUT_PROPERTIES } from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearGetCycleTool: ToolConfig<LinearGetCycleParams, LinearGetCycleResponse> = {
  id: 'linear_get_cycle',
  name: 'Linear Get Cycle',
  description: 'Get a single cycle by ID from Linear',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'linear',
  },

  params: {
    cycleId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Cycle ID',
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
        query GetCycle($id: String!) {
          cycle(id: $id) {
            id
            number
            name
            startsAt
            endsAt
            completedAt
            progress
            createdAt
            team {
              id
              name
            }
          }
        }
      `,
      variables: {
        id: params.cycleId,
      },
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to fetch cycle',
        output: {},
      }
    }

    return {
      success: true,
      output: {
        cycle: data.data.cycle,
      },
    }
  },

  outputs: {
    cycle: {
      type: 'object',
      description: 'The cycle with full details',
      properties: CYCLE_FULL_OUTPUT_PROPERTIES,
    },
  },
}
