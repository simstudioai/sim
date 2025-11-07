import type {
  LinearListWorkflowStatesParams,
  LinearListWorkflowStatesResponse,
} from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearListWorkflowStatesTool: ToolConfig<
  LinearListWorkflowStatesParams,
  LinearListWorkflowStatesResponse
> = {
  id: 'linear_list_workflow_states',
  name: 'Linear List Workflow States',
  description: 'List all workflow states (statuses) in Linear',
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
      description: 'Number of states to return (default: 50)',
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
          query ListWorkflowStates($filter: WorkflowStateFilter, $first: Int, $after: String) {
            workflowStates(filter: $filter, first: $first, after: $after) {
              nodes {
                id
                name
                type
                color
                position
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
        error: data.errors[0]?.message || 'Failed to list workflow states',
        output: {},
      }
    }

    const result = data.data.workflowStates
    return {
      success: true,
      output: {
        states: result.nodes,
        pageInfo: {
          hasNextPage: result.pageInfo.hasNextPage,
          endCursor: result.pageInfo.endCursor,
        },
      },
    }
  },

  outputs: {
    states: {
      type: 'array',
      description: 'Array of workflow states',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'State ID' },
          name: { type: 'string', description: 'State name (e.g., "Todo", "In Progress")' },
          type: {
            type: 'string',
            description: 'State type (e.g., "unstarted", "started", "completed")',
          },
          color: { type: 'string', description: 'State color' },
          position: { type: 'number', description: 'State position in workflow' },
          team: { type: 'object', description: 'Team this state belongs to' },
        },
      },
    },
    pageInfo: {
      type: 'object',
      description: 'Pagination information',
    },
  },
}
