import type { GitLabCreateIssueParams, GitLabCreateIssueResponse } from '@/tools/gitlab/types'
import type { ToolConfig } from '@/tools/types'

export const gitlabCreateIssueTool: ToolConfig<GitLabCreateIssueParams, GitLabCreateIssueResponse> =
  {
    id: 'gitlab_create_issue',
    name: 'GitLab Create Issue',
    description: 'Create a new issue in a GitLab project',
    version: '1.0.0',

    params: {
      accessToken: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'GitLab Personal Access Token',
      },
      projectId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Project ID or URL-encoded path',
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
        description: 'Issue description (Markdown supported)',
      },
      labels: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Comma-separated list of label names',
      },
      assigneeIds: {
        type: 'array',
        required: false,
        visibility: 'user-or-llm',
        description: 'Array of user IDs to assign',
      },
      milestoneId: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Milestone ID to assign',
      },
      dueDate: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Due date in YYYY-MM-DD format',
      },
      confidential: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Whether the issue is confidential',
      },
    },

    request: {
      url: (params) => {
        const encodedId = encodeURIComponent(String(params.projectId))
        return `https://gitlab.com/api/v4/projects/${encodedId}/issues`
      },
      method: 'POST',
      headers: (params) => ({
        'Content-Type': 'application/json',
        'PRIVATE-TOKEN': params.accessToken,
      }),
      body: (params) => {
        const body: Record<string, any> = {
          title: params.title,
        }

        if (params.description) body.description = params.description
        if (params.labels) body.labels = params.labels
        if (params.assigneeIds) body.assignee_ids = params.assigneeIds
        if (params.milestoneId) body.milestone_id = params.milestoneId
        if (params.dueDate) body.due_date = params.dueDate
        if (params.confidential !== undefined) body.confidential = params.confidential

        return body
      },
    },

    transformResponse: async (response) => {
      if (!response.ok) {
        const errorText = await response.text()
        return {
          success: false,
          error: `GitLab API error: ${response.status} ${errorText}`,
          output: {},
        }
      }

      const issue = await response.json()

      return {
        success: true,
        output: {
          issue,
        },
      }
    },

    outputs: {
      issue: {
        type: 'object',
        description: 'The created GitLab issue',
      },
    },
  }
