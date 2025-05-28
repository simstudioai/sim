import type { ToolConfig } from '../types'
import type { LinearReadIssuesParams, LinearReadIssuesResponse } from './types'

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
    teamId: { type: 'string', required: true, description: 'Linear team ID' },
    projectId: { type: 'string', required: true, description: 'Linear project ID' },
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
