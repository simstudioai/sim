import type { LinearUpdateIssueParams, LinearUpdateIssueResponse } from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearUpdateIssueTool: ToolConfig<LinearUpdateIssueParams, LinearUpdateIssueResponse> =
  {
    id: 'linear_update_issue',
    name: 'Linear Update Issue',
    description: 'Update an existing issue in Linear',
    version: '1.0.0',

    oauth: {
      required: true,
      provider: 'linear',
    },

    params: {
      issueId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Linear issue ID to update',
      },
      title: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'New issue title',
      },
      description: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'New issue description',
      },
      stateId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Workflow state ID (status)',
      },
      assigneeId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'User ID to assign the issue to',
      },
      priority: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Priority (0=No priority, 1=Urgent, 2=High, 3=Normal, 4=Low)',
      },
      estimate: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Estimate in points',
      },
      labelIds: {
        type: 'array',
        required: false,
        visibility: 'user-or-llm',
        description: 'Array of label IDs to set on the issue',
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
        const input: Record<string, any> = {}

        if (params.title !== undefined) input.title = params.title
        if (params.description !== undefined) input.description = params.description
        if (params.stateId !== undefined) input.stateId = params.stateId
        if (params.assigneeId !== undefined) input.assigneeId = params.assigneeId
        if (params.priority !== undefined) input.priority = Number(params.priority)
        if (params.estimate !== undefined) input.estimate = Number(params.estimate)
        if (params.labelIds !== undefined) input.labelIds = params.labelIds

        return {
          query: `
          mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
            issueUpdate(id: $id, input: $input) {
              success
              issue {
                id
                title
                description
                priority
                estimate
                url
                updatedAt
                state {
                  id
                  name
                  type
                }
                assignee {
                  id
                  name
                  email
                }
                team {
                  id
                }
                project {
                  id
                }
                labels {
                  nodes {
                    id
                    name
                    color
                  }
                }
              }
            }
          }
        `,
          variables: {
            id: params.issueId,
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
          error: data.errors[0]?.message || 'Failed to update issue',
          output: {},
        }
      }

      const result = data.data.issueUpdate
      if (!result.success) {
        return {
          success: false,
          error: 'Issue update was not successful',
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
            priority: issue.priority,
            estimate: issue.estimate,
            url: issue.url,
            updatedAt: issue.updatedAt,
            state: issue.state,
            assignee: issue.assignee,
            teamId: issue.team?.id,
            projectId: issue.project?.id,
            labels: issue.labels?.nodes || [],
          },
        },
      }
    },

    outputs: {
      issue: {
        type: 'object',
        description: 'The updated issue',
        properties: {
          id: { type: 'string', description: 'Issue ID' },
          title: { type: 'string', description: 'Issue title' },
          description: { type: 'string', description: 'Issue description' },
          priority: { type: 'number', description: 'Issue priority' },
          estimate: { type: 'number', description: 'Issue estimate' },
          state: { type: 'object', description: 'Issue state' },
          assignee: { type: 'object', description: 'Assigned user' },
          labels: { type: 'array', description: 'Issue labels' },
          updatedAt: { type: 'string', description: 'Last update timestamp' },
        },
      },
    },
  }
