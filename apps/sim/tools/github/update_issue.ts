import type { IssueResponse, UpdateIssueParams } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const updateIssueTool: ToolConfig<UpdateIssueParams, IssueResponse> = {
  id: 'github_update_issue',
  name: 'GitHub Update Issue',
  description: 'Update an existing issue in a GitHub repository',
  version: '1.0.0',

  params: {
    owner: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Repository owner',
    },
    repo: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Repository name',
    },
    issue_number: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Issue number',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New issue title',
    },
    body: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New issue description/body',
    },
    state: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Issue state (open or closed)',
    },
    labels: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Array of label names (replaces all existing labels)',
    },
    assignees: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Array of usernames (replaces all existing assignees)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub API token',
    },
  },

  request: {
    url: (params) =>
      `https://api.github.com/repos/${params.owner}/${params.repo}/issues/${params.issue_number}`,
    method: 'PATCH',
    headers: (params) => ({
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
    body: (params) => {
      const body: any = {}
      if (params.title !== undefined) body.title = params.title
      if (params.body !== undefined) body.body = params.body
      if (params.state !== undefined) body.state = params.state
      if (params.labels !== undefined) body.labels = params.labels
      if (params.assignees !== undefined) body.assignees = params.assignees
      return body
    },
  },

  transformResponse: async (response) => {
    const issue = await response.json()

    const labels = issue.labels?.map((label: any) => label.name) || []

    const assignees = issue.assignees?.map((assignee: any) => assignee.login) || []

    const content = `Issue #${issue.number} updated: "${issue.title}"
State: ${issue.state}
URL: ${issue.html_url}
${labels.length > 0 ? `Labels: ${labels.join(', ')}` : ''}
${assignees.length > 0 ? `Assignees: ${assignees.join(', ')}` : ''}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          number: issue.number,
          title: issue.title,
          state: issue.state,
          html_url: issue.html_url,
          labels,
          assignees,
          created_at: issue.created_at,
          updated_at: issue.updated_at,
          closed_at: issue.closed_at,
          body: issue.body,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable issue update confirmation' },
    metadata: {
      type: 'object',
      description: 'Updated issue metadata',
      properties: {
        number: { type: 'number', description: 'Issue number' },
        title: { type: 'string', description: 'Issue title' },
        state: { type: 'string', description: 'Issue state (open/closed)' },
        html_url: { type: 'string', description: 'GitHub web URL' },
        labels: { type: 'array', description: 'Array of label names' },
        assignees: { type: 'array', description: 'Array of assignee usernames' },
        created_at: { type: 'string', description: 'Creation timestamp' },
        updated_at: { type: 'string', description: 'Last update timestamp' },
        closed_at: { type: 'string', description: 'Closed timestamp' },
        body: { type: 'string', description: 'Issue body/description' },
      },
    },
  },
}
