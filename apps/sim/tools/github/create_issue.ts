import type { CreateIssueParams, IssueResponse } from '@/tools/github/types'
import {
  ISSUE_OUTPUT_PROPERTIES,
  LABEL_OUTPUT,
  MILESTONE_OUTPUT,
  USER_OUTPUT,
} from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const createIssueTool: ToolConfig<CreateIssueParams, IssueResponse> = {
  id: 'github_create_issue',
  name: 'GitHub Create Issue',
  description: 'Create a new issue in a GitHub repository',
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
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Issue title',
    },
    body: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Issue description/body',
    },
    assignees: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of usernames to assign to this issue',
    },
    labels: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of label names to add to this issue',
    },
    milestone: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Milestone number to associate with this issue',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub API token',
    },
  },

  request: {
    url: (params) => `https://api.github.com/repos/${params.owner}/${params.repo}/issues`,
    method: 'POST',
    headers: (params) => ({
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
    body: (params) => {
      const body: any = {
        title: params.title,
      }
      if (params.body) body.body = params.body
      if (params.assignees) {
        const assigneesArray = params.assignees
          .split(',')
          .map((a) => a.trim())
          .filter((a) => a)
        if (assigneesArray.length > 0) body.assignees = assigneesArray
      }
      if (params.labels) {
        const labelsArray = params.labels
          .split(',')
          .map((l) => l.trim())
          .filter((l) => l)
        if (labelsArray.length > 0) body.labels = labelsArray
      }
      if (params.milestone) body.milestone = params.milestone
      return body
    },
  },

  transformResponse: async (response) => {
    const issue = await response.json()

    const labels = issue.labels?.map((label: any) => label.name) || []

    const assignees = issue.assignees?.map((assignee: any) => assignee.login) || []

    const content = `Issue #${issue.number} created: "${issue.title}"
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
          body: issue.body,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable issue creation confirmation' },
    metadata: {
      type: 'object',
      description: 'Issue metadata',
      properties: {
        number: { type: 'number', description: 'Issue number' },
        title: { type: 'string', description: 'Issue title' },
        state: { type: 'string', description: 'Issue state (open/closed)' },
        html_url: { type: 'string', description: 'GitHub web URL' },
        labels: { type: 'array', description: 'Array of label names' },
        assignees: { type: 'array', description: 'Array of assignee usernames' },
        created_at: { type: 'string', description: 'Creation timestamp' },
        updated_at: { type: 'string', description: 'Last update timestamp' },
        body: { type: 'string', description: 'Issue body/description' },
      },
    },
  },
}

export const createIssueV2Tool: ToolConfig<CreateIssueParams, any> = {
  id: 'github_create_issue_v2',
  name: createIssueTool.name,
  description: createIssueTool.description,
  version: '2.0.0',
  params: createIssueTool.params,
  request: createIssueTool.request,

  transformResponse: async (response: Response) => {
    const issue = await response.json()
    return {
      success: true,
      output: {
        id: issue.id,
        number: issue.number,
        title: issue.title,
        state: issue.state,
        html_url: issue.html_url,
        body: issue.body ?? null,
        user: issue.user,
        labels: issue.labels ?? [],
        assignees: issue.assignees ?? [],
        milestone: issue.milestone ?? null,
        created_at: issue.created_at,
        updated_at: issue.updated_at,
        closed_at: issue.closed_at ?? null,
      },
    }
  },

  outputs: {
    ...ISSUE_OUTPUT_PROPERTIES,
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
    milestone: { ...MILESTONE_OUTPUT, optional: true },
  },
}
