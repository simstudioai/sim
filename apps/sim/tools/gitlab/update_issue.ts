import type { GitLabUpdateIssueParams, GitLabUpdateIssueResponse } from '@/tools/gitlab/types'
import type { ToolConfig } from '@/tools/types'

export const gitlabUpdateIssueTool: ToolConfig<GitLabUpdateIssueParams, GitLabUpdateIssueResponse> =
  {
    id: 'gitlab_update_issue',
    name: 'GitLab Update Issue',
    description: 'Update an existing issue in a GitLab project',
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
      issueIid: {
        type: 'number',
        required: true,
        visibility: 'user-or-llm',
        description: 'Issue internal ID (IID)',
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
        description: 'New issue description (Markdown supported)',
      },
      stateEvent: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'State event (close or reopen)',
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
        return `https://gitlab.com/api/v4/projects/${encodedId}/issues/${params.issueIid}`
      },
      method: 'PUT',
      headers: (params) => ({
        'Content-Type': 'application/json',
        'PRIVATE-TOKEN': params.accessToken,
      }),
      body: (params) => {
        const body: Record<string, any> = {}

        if (params.title) body.title = params.title
        if (params.description !== undefined) body.description = params.description
        if (params.stateEvent) body.state_event = params.stateEvent
        if (params.labels !== undefined) body.labels = params.labels
        if (params.assigneeIds) body.assignee_ids = params.assigneeIds
        if (params.milestoneId !== undefined) body.milestone_id = params.milestoneId
        if (params.dueDate !== undefined) body.due_date = params.dueDate
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
        description: 'The updated GitLab issue',
      },
    },
  }
