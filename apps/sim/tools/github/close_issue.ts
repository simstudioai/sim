import type { CloseIssueParams, IssueResponse } from '@/tools/github/types'
import { ISSUE_OUTPUT_PROPERTIES, LABEL_OUTPUT, USER_OUTPUT } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const closeIssueTool: ToolConfig<CloseIssueParams, IssueResponse> = {
  id: 'github_close_issue',
  name: 'GitHub Close Issue',
  description: 'Close an issue in a GitHub repository',
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
    state_reason: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reason for closing: completed or not_planned',
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
      const body: any = {
        state: 'closed',
      }
      if (params.state_reason) {
        body.state_reason = params.state_reason
      }
      return body
    },
  },

  transformResponse: async (response) => {
    const issue = await response.json()

    const labels = issue.labels?.map((label: any) => label.name) || []

    const assignees = issue.assignees?.map((assignee: any) => assignee.login) || []

    const content = `Issue #${issue.number} closed: "${issue.title}"
State: ${issue.state}
${issue.state_reason ? `Reason: ${issue.state_reason}` : ''}
Closed at: ${issue.closed_at}
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
          closed_at: issue.closed_at,
          body: issue.body,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable issue close confirmation' },
    metadata: {
      type: 'object',
      description: 'Closed issue metadata',
      properties: {
        number: { type: 'number', description: 'Issue number' },
        title: { type: 'string', description: 'Issue title' },
        state: { type: 'string', description: 'Issue state (closed)' },
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

export const closeIssueV2Tool: ToolConfig<CloseIssueParams, any> = {
  id: 'github_close_issue_v2',
  name: closeIssueTool.name,
  description: closeIssueTool.description,
  version: '2.0.0',
  params: closeIssueTool.params,
  request: closeIssueTool.request,

  transformResponse: async (response: Response) => {
    const issue = await response.json()
    return {
      success: true,
      output: {
        id: issue.id,
        number: issue.number,
        title: issue.title,
        state: issue.state,
        state_reason: issue.state_reason ?? null,
        html_url: issue.html_url,
        body: issue.body ?? null,
        user: issue.user,
        labels: issue.labels ?? [],
        assignees: issue.assignees ?? [],
        closed_at: issue.closed_at ?? null,
        created_at: issue.created_at,
        updated_at: issue.updated_at,
      },
    }
  },

  outputs: {
    ...ISSUE_OUTPUT_PROPERTIES,
    state_reason: { type: 'string', description: 'Reason for closing', optional: true },
    user: USER_OUTPUT,
    labels: {
      type: 'array',
      description: 'Array of label objects',
      items: LABEL_OUTPUT,
    },
    assignees: {
      type: 'array',
      description: 'Array of assignee objects',
      items: USER_OUTPUT,
    },
  },
}
