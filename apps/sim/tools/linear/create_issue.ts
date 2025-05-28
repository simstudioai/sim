import type { ToolConfig } from '../types'
import type { LinearCreateIssueParams, LinearCreateIssueResponse } from './types'

export const linearCreateIssueTool: ToolConfig<LinearCreateIssueParams, LinearCreateIssueResponse> = {
  id: 'linear_create_issue',
  name: 'Linear Issue Writer',
  description: 'Create a new issue in Linear',
  version: '1.0.0',
  oauth: {
    required: true,
    provider: 'linear',
  },
  params: {
    teamId: { type: 'string', required: true, description: 'Linear team ID' },
    projectId: { type: 'string', required: false, description: 'Linear project ID' },
    title: { type: 'string', required: true, description: 'Issue title' },
    description: { type: 'string', required: false, description: 'Issue description' },
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
        mutation CreateIssue($teamId: String!, $projectId: String, $title: String!, $description: String) {
          issueCreate(
            input: {
              teamId: $teamId
              projectId: $projectId
              title: $title
              description: $description
            }
          ) {
            issue {
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
        title: params.title,
        description: params.description,
      },
    }),
  },
  transformResponse: async (response) => {
    const data = await response.json()
    if (data.errors) {
      return {
        success: false,
        output: {
          issue: {
            id: '',
            title: '',
            description: '',
            state: '',
            teamId: '',
            projectId: '',
          },
        },
        error: data.errors[0].message,
      }
    }
    return {
      success: true,
      output: {
        issue: data.data.issueCreate.issue
          ? {
              id: data.data.issueCreate.issue.id,
              title: data.data.issueCreate.issue.title,
              description: data.data.issueCreate.issue.description,
              state: data.data.issueCreate.issue.state?.name,
              teamId: data.data.issueCreate.issue.team?.id,
              projectId: data.data.issueCreate.issue.project?.id,
            }
          : {
              id: '',
              title: '',
              description: '',
              state: '',
              teamId: '',
              projectId: '',
            },
      },
    }
  },
  transformError: (error) => error.message || 'Failed to create Linear issue',
}
