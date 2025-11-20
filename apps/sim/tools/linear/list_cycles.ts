import type { LinearListCyclesParams, LinearListCyclesResponse } from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearListCyclesTool: ToolConfig<LinearListCyclesParams, LinearListCyclesResponse> = {
  id: 'linear_list_cycles',
  name: 'Linear List Cycles',
  description: 'List cycles (sprints/iterations) in Linear',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'linear',
  },

  params: {
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by team ID',
    },
    first: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of cycles to return (default: 50)',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor for pagination',
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
    body: (params) => {
      const filter: Record<string, any> = {}
      if (params.teamId) {
        filter.team = { id: { eq: params.teamId } }
      }

      return {
        query: `
          query ListCycles($filter: CycleFilter, $first: Int, $after: String) {
            cycles(filter: $filter, first: $first, after: $after) {
              nodes {
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
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        `,
        variables: {
          filter: Object.keys(filter).length > 0 ? filter : undefined,
          first: params.first ? Number(params.first) : 50,
          after: params.after,
        },
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to list cycles',
        output: {},
      }
    }

    const result = data.data.cycles
    return {
      success: true,
      output: {
        cycles: result.nodes,
        pageInfo: {
          hasNextPage: result.pageInfo.hasNextPage,
          endCursor: result.pageInfo.endCursor,
        },
      },
    }
  },

  outputs: {
    cycles: {
      type: 'array',
      description: 'Array of cycles',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Cycle ID' },
          number: { type: 'number', description: 'Cycle number' },
          name: { type: 'string', description: 'Cycle name' },
          startsAt: { type: 'string', description: 'Start date' },
          endsAt: { type: 'string', description: 'End date' },
          completedAt: { type: 'string', description: 'Completion date' },
          progress: { type: 'number', description: 'Progress percentage (0-1)' },
          team: { type: 'object', description: 'Team this cycle belongs to' },
        },
      },
    },
    pageInfo: {
      type: 'object',
      description: 'Pagination information',
    },
  },
}
