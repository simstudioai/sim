import type { ToolConfig } from '../types'
import type { LinearCreateIssueParams, LinearCreateIssueResponse } from './types'

export const linearCreateIssueTool: ToolConfig<LinearCreateIssueParams, LinearCreateIssueResponse> =
  {
    id: 'linear_create_issue',
    name: 'Linear Issue Writer',
    description: 'Create a new issue in Linear',
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
      title: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Issue title',
      },
      description: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Issue description',
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
        if (!params.title || !params.title.trim()) {
          throw new Error('Title is required to create a Linear issue')
        }
        return {
          query: `
        mutation CreateIssue($teamId: String!, $projectId: String!, $title: String!, $description: String) {
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
        }
      },
    },
    transformResponse: async (response) => {
      const data = await response.json()
      const issue = data.data.issueCreate.issue
      if (!issue) {
        throw new Error('Failed to create issue: No issue returned from Linear API')
      }
      return {
        success: true,
        output: {
          issue: {
            id: issue.id,
            title: issue.title,
            description: issue.description,
            state: issue.state?.name,
            teamId: issue.team?.id,
            projectId: issue.project?.id,
          },
        },
      }
    },
    transformError: (error) => {
      if (error instanceof Error) {
        return error.message
      }

      if (typeof error === 'object' && error !== null) {
        if (error.error) {
          return typeof error.error === 'string' ? error.error : JSON.stringify(error.error)
        }
        if (error.message) {
          return error.message
        }
      }

      return 'Failed to create Linear issue'
    },
  }
