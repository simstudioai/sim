import type { LinearListLabelsParams, LinearListLabelsResponse } from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearListLabelsTool: ToolConfig<LinearListLabelsParams, LinearListLabelsResponse> = {
  id: 'linear_list_labels',
  name: 'Linear List Labels',
  description: 'List all labels in Linear workspace or team',
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
      description: 'Number of labels to return (default: 50)',
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
          query ListLabels($filter: IssueLabelFilter, $first: Int, $after: String) {
            issueLabels(filter: $filter, first: $first, after: $after) {
              nodes {
                id
                name
                color
                description
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
        error: data.errors[0]?.message || 'Failed to list labels',
        output: {},
      }
    }

    const result = data.data.issueLabels
    return {
      success: true,
      output: {
        labels: result.nodes,
        pageInfo: {
          hasNextPage: result.pageInfo.hasNextPage,
          endCursor: result.pageInfo.endCursor,
        },
      },
    }
  },

  outputs: {
    labels: {
      type: 'array',
      description: 'Array of labels',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Label ID' },
          name: { type: 'string', description: 'Label name' },
          color: { type: 'string', description: 'Label color (hex)' },
          description: { type: 'string', description: 'Label description' },
          team: { type: 'object', description: 'Team this label belongs to' },
        },
      },
    },
    pageInfo: {
      type: 'object',
      description: 'Pagination information',
    },
  },
}
