import type { ToolConfig } from '../types'
import type { LinearIssue, LinearReadIssuesParams, LinearReadIssuesResponse } from './types'

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
    if (data.errors) {
      return {
        success: false,
        output: { issues: [] },
        error: data.errors.map((e: any) => e.message).join('; '),
      }
    }
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
  transformError: (error) => {
    // If it's an Error instance with a message, use that
    if (error instanceof Error) {
      return error.message
    }

    // If it's an object with an error or message property
    if (typeof error === 'object' && error !== null) {
      if (error.error) {
        return typeof error.error === 'string' ? error.error : JSON.stringify(error.error)
      }
      if (error.message) {
        return error.message
      }
    }

    // Default fallback message
    return 'Failed to fetch Linear issues'
  },
}
