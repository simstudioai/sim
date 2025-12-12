import type { GetIssueParams, IssueResponse } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const getIssueTool: ToolConfig<GetIssueParams, IssueResponse> = {
  id: 'github_get_issue',
  name: 'GitHub Get Issue',
  description: 'Get detailed information about a specific issue in a GitHub repository',
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
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
  },

  transformResponse: async (response) => {
    const issue = await response.json()

    const labels = issue.labels?.map((label: any) => label.name) || []

    const assignees = issue.assignees?.map((assignee: any) => assignee.login) || []

    const content = `Issue #${issue.number}: "${issue.title}"
State: ${issue.state}
Created: ${issue.created_at}
Updated: ${issue.updated_at}
${issue.closed_at ? `Closed: ${issue.closed_at}` : ''}
URL: ${issue.html_url}
${labels.length > 0 ? `Labels: ${labels.join(', ')}` : 'No labels'}
${assignees.length > 0 ? `Assignees: ${assignees.join(', ')}` : 'No assignees'}

Description:
${issue.body || 'No description provided'}`

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
    content: { type: 'string', description: 'Human-readable issue details' },
    metadata: {
      type: 'object',
      description: 'Detailed issue metadata',
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
