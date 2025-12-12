import type { LinearListTeamsParams, LinearListTeamsResponse } from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearListTeamsTool: ToolConfig<LinearListTeamsParams, LinearListTeamsResponse> = {
  id: 'linear_list_teams',
  name: 'Linear List Teams',
  description: 'List all teams in the Linear workspace',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'linear',
  },

  params: {
    first: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of teams to return (default: 50)',
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
    body: (params) => ({
      query: `
        query ListTeams($first: Int, $after: String) {
          teams(first: $first, after: $after) {
            nodes {
              id
              name
              key
              description
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `,
      variables: {
        first: params.first ? Number(params.first) : 50,
        after: params.after,
      },
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to list teams',
        output: {},
      }
    }

    const result = data.data.teams
    return {
      success: true,
      output: {
        teams: result.nodes,
        pageInfo: {
          hasNextPage: result.pageInfo.hasNextPage,
          endCursor: result.pageInfo.endCursor,
        },
      },
    }
  },

  outputs: {
    teams: {
      type: 'array',
      description: 'Array of teams',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Team ID' },
          name: { type: 'string', description: 'Team name' },
          key: { type: 'string', description: 'Team key (used in issue identifiers)' },
          description: { type: 'string', description: 'Team description' },
        },
      },
    },
    pageInfo: {
      type: 'object',
      description: 'Pagination information',
    },
  },
}
