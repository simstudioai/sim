import type { AddAssigneesParams, IssueResponse } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const addAssigneesTool: ToolConfig<AddAssigneesParams, IssueResponse> = {
  id: 'github_add_assignees',
  name: 'GitHub Add Assignees',
  description: 'Add assignees to an issue in a GitHub repository',
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
    assignees: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of usernames to assign to the issue',
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
      `https://api.github.com/repos/${params.owner}/${params.repo}/issues/${params.issue_number}/assignees`,
    method: 'POST',
    headers: (params) => ({
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
    body: (params) => {
      const assigneesArray = params.assignees
        .split(',')
        .map((a) => a.trim())
        .filter((a) => a)
      return {
        assignees: assigneesArray,
      }
    },
  },

  transformResponse: async (response) => {
    const issue = await response.json()
    const labels = issue.labels?.map((label: any) => label.name) || []
    const assignees = issue.assignees?.map((assignee: any) => assignee.login) || []
    const content = `Assignees added to issue #${issue.number}: "${issue.title}"
All assignees: ${assignees.join(', ')}
URL: ${issue.html_url}`

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
          body: issue.body,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable assignees confirmation' },
    metadata: {
      type: 'object',
      description: 'Updated issue metadata with assignees',
      properties: {
        number: { type: 'number', description: 'Issue number' },
        title: { type: 'string', description: 'Issue title' },
        state: { type: 'string', description: 'Issue state (open/closed)' },
        html_url: { type: 'string', description: 'GitHub web URL' },
        labels: { type: 'array', description: 'Array of label names' },
        assignees: { type: 'array', description: 'All assignees on the issue' },
        created_at: { type: 'string', description: 'Creation timestamp' },
        updated_at: { type: 'string', description: 'Last update timestamp' },
        body: { type: 'string', description: 'Issue body/description' },
      },
    },
  },
}
