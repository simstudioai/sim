import type { LinearGetIssueParams, LinearGetIssueResponse } from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearGetIssueTool: ToolConfig<LinearGetIssueParams, LinearGetIssueResponse> = {
  id: 'linear_get_issue',
  name: 'Linear Get Issue',
  description: 'Get a single issue by ID from Linear with full details',
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
      description: 'Linear issue ID',
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
        query GetIssue($id: String!) {
          issue(id: $id) {
            id
            title
            description
            priority
            estimate
            url
            createdAt
            updatedAt
            completedAt
            canceledAt
            archivedAt
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
              name
            }
            project {
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
      `,
      variables: {
        id: params.issueId,
      },
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to fetch issue',
        output: {},
      }
    }

    const issue = data.data.issue
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
          createdAt: issue.createdAt,
          updatedAt: issue.updatedAt,
          completedAt: issue.completedAt,
          canceledAt: issue.canceledAt,
          archivedAt: issue.archivedAt,
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
      description: 'The issue with full details',
      properties: {
        id: { type: 'string', description: 'Issue ID' },
        title: { type: 'string', description: 'Issue title' },
        description: { type: 'string', description: 'Issue description' },
        priority: { type: 'number', description: 'Issue priority (0-4)' },
        estimate: { type: 'number', description: 'Issue estimate in points' },
        url: { type: 'string', description: 'Issue URL' },
        state: { type: 'object', description: 'Issue state/status' },
        assignee: { type: 'object', description: 'Assigned user' },
        labels: { type: 'array', description: 'Issue labels' },
        createdAt: { type: 'string', description: 'Creation timestamp' },
        updatedAt: { type: 'string', description: 'Last update timestamp' },
      },
    },
  },
}
