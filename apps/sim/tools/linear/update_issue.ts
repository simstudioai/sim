import type { LinearUpdateIssueParams, LinearUpdateIssueResponse } from '@/tools/linear/types'
import { ISSUE_EXTENDED_OUTPUT_PROPERTIES } from '@/tools/linear/types'
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
        description: 'Array of label IDs to set on the issue (replaces all existing labels)',
      },
      projectId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Project ID to move the issue to',
      },
      cycleId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Cycle ID to assign the issue to',
      },
      parentId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Parent issue ID (for making this a sub-issue)',
      },
      dueDate: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Due date in ISO 8601 format (date only: YYYY-MM-DD)',
      },
      addedLabelIds: {
        type: 'array',
        required: false,
        visibility: 'user-or-llm',
        description: 'Array of label IDs to add to the issue (without replacing existing labels)',
      },
      removedLabelIds: {
        type: 'array',
        required: false,
        visibility: 'user-or-llm',
        description: 'Array of label IDs to remove from the issue',
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

        if (params.title != null && params.title !== '') {
          input.title = params.title
        }
        if (params.description != null && params.description !== '') {
          input.description = params.description
        }
        if (params.stateId != null && params.stateId !== '') {
          input.stateId = params.stateId
        }
        if (params.assigneeId != null && params.assigneeId !== '') {
          input.assigneeId = params.assigneeId
        }
        if (params.priority != null) {
          input.priority = Number(params.priority)
        }
        if (params.estimate != null) {
          input.estimate = Number(params.estimate)
        }
        if (params.labelIds != null && Array.isArray(params.labelIds)) {
          input.labelIds = params.labelIds
        }
        if (params.projectId != null && params.projectId !== '') {
          input.projectId = params.projectId
        }
        if (params.cycleId != null && params.cycleId !== '') {
          input.cycleId = params.cycleId
        }
        if (params.parentId != null && params.parentId !== '') {
          input.parentId = params.parentId
        }
        if (params.dueDate != null && params.dueDate !== '') {
          input.dueDate = params.dueDate
        }
        if (params.addedLabelIds != null && Array.isArray(params.addedLabelIds)) {
          input.addedLabelIds = params.addedLabelIds
        }
        if (params.removedLabelIds != null && Array.isArray(params.removedLabelIds)) {
          input.removedLabelIds = params.removedLabelIds
        }

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
                dueDate
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
                cycle {
                  id
                  number
                  name
                }
                parent {
                  id
                  title
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
            dueDate: issue.dueDate,
            state: issue.state,
            assignee: issue.assignee,
            teamId: issue.team?.id,
            projectId: issue.project?.id,
            cycleId: issue.cycle?.id,
            cycleNumber: issue.cycle?.number,
            cycleName: issue.cycle?.name,
            parentId: issue.parent?.id,
            parentTitle: issue.parent?.title,
            labels: issue.labels?.nodes || [],
          },
        },
      }
    },

    outputs: {
      issue: {
        type: 'object',
        description: 'The updated issue',
        properties: ISSUE_EXTENDED_OUTPUT_PROPERTIES,
      },
    },
  }
