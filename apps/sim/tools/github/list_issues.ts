import type { IssuesListResponse, ListIssuesParams } from '@/tools/github/types'
import {
  ISSUE_OUTPUT_PROPERTIES,
  LABEL_OUTPUT,
  MILESTONE_OUTPUT,
  USER_OUTPUT,
} from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const listIssuesTool: ToolConfig<ListIssuesParams, IssuesListResponse> = {
  id: 'github_list_issues',
  name: 'GitHub List Issues',
  description:
    'List issues in a GitHub repository. Note: This includes pull requests as PRs are considered issues in GitHub',
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
    state: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by state: open, closed, or all (default: open)',
      default: 'open',
    },
    assignee: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by assignee username',
    },
    creator: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by creator username',
    },
    labels: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of label names to filter by',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort by: created, updated, or comments (default: created)',
      default: 'created',
    },
    direction: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort direction: asc or desc (default: desc)',
      default: 'desc',
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Results per page (max 100, default: 30)',
      default: 30,
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number (default: 1)',
      default: 1,
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub API token',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`https://api.github.com/repos/${params.owner}/${params.repo}/issues`)
      if (params.state) url.searchParams.append('state', params.state)
      if (params.assignee) url.searchParams.append('assignee', params.assignee)
      if (params.creator) url.searchParams.append('creator', params.creator)
      if (params.labels) url.searchParams.append('labels', params.labels)
      if (params.sort) url.searchParams.append('sort', params.sort)
      if (params.direction) url.searchParams.append('direction', params.direction)
      if (params.per_page) url.searchParams.append('per_page', Number(params.per_page).toString())
      if (params.page) url.searchParams.append('page', Number(params.page).toString())
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
  },

  transformResponse: async (response) => {
    const issues = await response.json()

    const transformedIssues = issues.map((issue: any) => ({
      number: issue.number,
      title: issue.title,
      state: issue.state,
      html_url: issue.html_url,
      labels: issue.labels?.map((label: any) => label.name) || [],
      assignees: issue.assignees?.map((assignee: any) => assignee.login) || [],
      created_at: issue.created_at,
      updated_at: issue.updated_at,
    }))

    const content = `Found ${issues.length} issue(s):
${transformedIssues
  .map(
    (issue: any) =>
      `#${issue.number}: "${issue.title}" (${issue.state}) - ${issue.html_url}
  ${issue.labels.length > 0 ? `Labels: ${issue.labels.join(', ')}` : 'No labels'}
  ${issue.assignees.length > 0 ? `Assignees: ${issue.assignees.join(', ')}` : 'No assignees'}`
  )
  .join('\n\n')}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          issues: transformedIssues,
          total_count: issues.length,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable list of issues' },
    metadata: {
      type: 'object',
      description: 'Issues list metadata',
      properties: {
        issues: {
          type: 'array',
          description: 'Array of issues',
          items: {
            type: 'object',
            properties: {
              number: { type: 'number', description: 'Issue number' },
              title: { type: 'string', description: 'Issue title' },
              state: { type: 'string', description: 'Issue state' },
              html_url: { type: 'string', description: 'GitHub web URL' },
              labels: { type: 'array', description: 'Array of label names' },
              assignees: { type: 'array', description: 'Array of assignee usernames' },
              created_at: { type: 'string', description: 'Creation timestamp' },
              updated_at: { type: 'string', description: 'Last update timestamp' },
            },
          },
        },
        total_count: { type: 'number', description: 'Total number of issues returned' },
      },
    },
  },
}

export const listIssuesV2Tool: ToolConfig<ListIssuesParams, any> = {
  id: 'github_list_issues_v2',
  name: listIssuesTool.name,
  description: listIssuesTool.description,
  version: '2.0.0',
  params: listIssuesTool.params,
  request: listIssuesTool.request,

  transformResponse: async (response: Response) => {
    const issues = await response.json()
    const items = issues.map((issue: any) => ({
      ...issue,
      body: issue.body ?? null,
      milestone: issue.milestone ?? null,
      closed_at: issue.closed_at ?? null,
      labels: issue.labels ?? [],
      assignees: issue.assignees ?? [],
    }))
    return {
      success: true,
      output: {
        items,
        count: issues.length,
      },
    }
  },

  outputs: {
    items: {
      type: 'array',
      description: 'Array of issue objects from GitHub API',
      items: {
        type: 'object',
        properties: {
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
      },
    },
    count: { type: 'number', description: 'Number of issues returned' },
  },
}
