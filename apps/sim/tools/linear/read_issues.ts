import type { ToolConfig } from '../types'
import type { LinearReadIssuesParams, LinearReadIssuesResponse } from './types'

export const linearReadIssuesTool: ToolConfig<LinearReadIssuesParams, LinearReadIssuesResponse> = {
  id: 'linear_read_issues',
  name: 'Linear Issue Reader',
  description: 'Fetch and filter issues from Linear',
  version: '1.0.0',
  params: {
    teamId: { type: 'string', required: false, description: 'Linear team ID' },
    projectId: { type: 'string', required: false, description: 'Linear project ID' },
    state: { type: 'string', required: false, description: 'Issue state' },
    search: { type: 'string', required: false, description: 'Search query' },
  },
  request: {
    url: 'https://api.linear.app/graphql',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken || ''}`,
    }),
    body: (params) => ({
      query: `
        query Issues($teamId: String, $projectId: String, $state: String, $search: String) {
          issues(
            filter: {
              team: { id: $teamId }
              project: { id: $projectId }
              state: { name: { eq: $state } }
              search: $search
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
        state: params.state,
        search: params.search,
      },
    }),
  },
  transformResponse: async (response) => {
    const data = await response.json()
    if (data.errors) {
      return { success: false, output: { issues: [] }, error: data.errors[0].message }
    }
    return {
      success: true,
      output: {
        issues: data.data.issues.nodes.map((issue: any) => ({
          id: issue.id,
          title: issue.title,
          description: issue.description,
          state: issue.state?.name,
          teamId: issue.team?.id,
          projectId: issue.project?.id,
        })),
      },
    }
  },
  transformError: (error) => error.message || 'Failed to fetch Linear issues',
}
