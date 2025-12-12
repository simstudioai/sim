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
        description: 'Parent issue ID (for creating sub-issues)',
      },
      dueDate: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Due date in ISO 8601 format (date only: YYYY-MM-DD)',
      },
      subscriberIds: {
        type: 'array',
        required: false,
        visibility: 'user-or-llm',
        description: 'Array of user IDs to subscribe to the issue',
      },
      projectMilestoneId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Project milestone ID to associate with the issue',
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

        if (params.projectId != null && params.projectId !== '') {
          input.projectId = params.projectId
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
        if (params.cycleId != null && params.cycleId !== '') {
          input.cycleId = params.cycleId
        }
        if (params.parentId != null && params.parentId !== '') {
          input.parentId = params.parentId
        }
        if (params.dueDate != null && params.dueDate !== '') {
          input.dueDate = params.dueDate
        }
        if (params.subscriberIds != null && Array.isArray(params.subscriberIds)) {
          input.subscriberIds = params.subscriberIds
        }
        if (params.projectMilestoneId != null && params.projectMilestoneId !== '') {
          input.projectMilestoneId = params.projectMilestoneId
        }

        return {
          query: `
        mutation CreateIssue($input: IssueCreateInput!) {
          issueCreate(input: $input) {
            issue {
              id
              title
              description
              priority
              estimate
              url
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
              team { id }
              project { id }
              cycle {
                id
                number
                name
              }
              parent {
                id
                title
              }
              projectMilestone {
                id
                name
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
            priority: issue.priority,
            estimate: issue.estimate,
            url: issue.url,
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
            projectMilestoneId: issue.projectMilestone?.id,
            projectMilestoneName: issue.projectMilestone?.name,
            labels: issue.labels?.nodes || [],
          },
        },
      }
    },

    outputs: {
      issue: {
        type: 'object',
        description: 'The created issue with all its properties',
        properties: {
          id: { type: 'string', description: 'Issue ID' },
          title: { type: 'string', description: 'Issue title' },
          description: { type: 'string', description: 'Issue description' },
          priority: { type: 'number', description: 'Issue priority' },
          estimate: { type: 'number', description: 'Issue estimate' },
          url: { type: 'string', description: 'Issue URL' },
          dueDate: { type: 'string', description: 'Due date (YYYY-MM-DD)' },
          state: { type: 'object', description: 'Issue state' },
          assignee: { type: 'object', description: 'Assigned user' },
          teamId: { type: 'string', description: 'Team ID' },
          projectId: { type: 'string', description: 'Project ID' },
          cycleId: { type: 'string', description: 'Cycle ID' },
          cycleNumber: { type: 'number', description: 'Cycle number' },
          cycleName: { type: 'string', description: 'Cycle name' },
          parentId: { type: 'string', description: 'Parent issue ID' },
          parentTitle: { type: 'string', description: 'Parent issue title' },
          projectMilestoneId: { type: 'string', description: 'Project milestone ID' },
          projectMilestoneName: { type: 'string', description: 'Project milestone name' },
          labels: { type: 'array', description: 'Issue labels' },
        },
      },
    },
  }
