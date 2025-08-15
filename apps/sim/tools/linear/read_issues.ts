import type {
  LinearIssue,
  LinearReadIssuesParams,
  LinearReadIssuesResponse,
} from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearReadIssuesTool: ToolConfig<LinearReadIssuesParams, LinearReadIssuesResponse> = {
  id: 'linear_read_issues',
  name: 'Linear Issue Reader',
  description: 'Fetch and filter issues from Linear',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'linear',
  },

  params: {
    teamId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Linear team ID',
    },
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Linear project ID',
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
        query Issues($teamId: ID!, $projectId: ID!) {
          issues(
            filter: {
              team: { id: { eq: $teamId } }
              project: { id: { eq: $projectId } }
            }
          ) {
            nodes {
              id
              title
              description
              state { name }
              team { id }
              project { id }
            }
          }
        }
      `,
      variables: {
        teamId: params.teamId,
        projectId: params.projectId,
      },
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        issues: (data.data.issues.nodes as LinearIssue[]).map((issue) => ({
          id: issue.id,
          title: issue.title,
          description: issue.description,
          state: issue.state,
          teamId: issue.teamId,
          projectId: issue.projectId,
        })),
      },
    }
  },

  outputs: {
    issues: {
      type: 'array',
      description:
        'Array of issues from the specified Linear team and project, each containing id, title, description, state, teamId, and projectId',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Issue ID' },
          title: { type: 'string', description: 'Issue title' },
          description: { type: 'string', description: 'Issue description' },
          state: { type: 'string', description: 'Issue state' },
          teamId: { type: 'string', description: 'Team ID' },
          projectId: { type: 'string', description: 'Project ID' },
        },
      },
    },
  },
}
