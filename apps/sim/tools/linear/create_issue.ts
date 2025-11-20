import type { LinearCreateIssueParams, LinearCreateIssueResponse } from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

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
        required: false,
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

        const input: Record<string, any> = {
          teamId: params.teamId,
          title: params.title,
        }

        if (
          params.projectId !== undefined &&
          params.projectId !== null &&
          params.projectId !== ''
        ) {
          input.projectId = params.projectId
        }
        if (
          params.description !== undefined &&
          params.description !== null &&
          params.description !== ''
        ) {
          input.description = params.description
        }

        return {
          query: `
        mutation CreateIssue($input: IssueCreateInput!) {
          issueCreate(input: $input) {
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
            input,
          },
        }
      },
    },

    transformResponse: async (response) => {
      const data = await response.json()

      if (data.errors) {
        return {
          success: false,
          error: data.errors[0]?.message || 'Failed to create issue',
          output: {},
        }
      }

      const result = data.data?.issueCreate
      if (!result) {
        return {
          success: false,
          error: 'Issue creation was not successful',
          output: {},
        }
      }

      const issue = result.issue
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

    outputs: {
      issue: {
        type: 'object',
        description:
          'The created issue containing id, title, description, state, teamId, and projectId',
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
  }
