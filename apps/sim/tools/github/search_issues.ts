import type { ToolConfig } from '@/tools/types'

interface SearchIssuesParams {
  q: string
  sort?:
    | 'comments'
    | 'reactions'
    | 'reactions-+1'
    | 'reactions--1'
    | 'reactions-smile'
    | 'reactions-thinking_face'
    | 'reactions-heart'
    | 'reactions-tada'
    | 'interactions'
    | 'created'
    | 'updated'
  order?: 'asc' | 'desc'
  per_page?: number
  page?: number
  apiKey: string
}

interface SearchIssuesResponse {
  success: boolean
  output: {
    content: string
    metadata: {
      total_count: number
      incomplete_results: boolean
      items: Array<{
        number: number
        title: string
        state: string
        html_url: string
        user: { login: string }
        labels: string[]
        created_at: string
        updated_at: string
        comments: number
        is_pull_request: boolean
        repository_url: string
      }>
    }
  }
}

export const searchIssuesTool: ToolConfig<SearchIssuesParams, SearchIssuesResponse> = {
  id: 'github_search_issues',
  name: 'GitHub Search Issues',
  description:
    'Search for issues and pull requests across GitHub. Use qualifiers like repo:owner/name, is:issue, is:pr, state:open, label:bug, author:user',
  version: '1.0.0',

  params: {
    q: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Search query with optional qualifiers (repo:, is:issue, is:pr, state:, label:, author:, assignee:)',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Sort by: comments, reactions, created, updated, interactions (default: best match)',
    },
    order: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order: asc or desc (default: desc)',
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
      const url = new URL('https://api.github.com/search/issues')
      url.searchParams.append('q', params.q)
      if (params.sort) url.searchParams.append('sort', params.sort)
      if (params.order) url.searchParams.append('order', params.order)
      if (params.per_page) url.searchParams.append('per_page', String(params.per_page))
      if (params.page) url.searchParams.append('page', String(params.page))
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
    const data = await response.json()

    const items = data.items.map((item: any) => ({
      number: item.number,
      title: item.title,
      state: item.state,
      html_url: item.html_url,
      user: { login: item.user?.login ?? 'unknown' },
      labels: item.labels?.map((l: any) => l.name) ?? [],
      created_at: item.created_at,
      updated_at: item.updated_at,
      comments: item.comments ?? 0,
      is_pull_request: !!item.pull_request,
      repository_url: item.repository_url,
    }))

    const content = `Found ${data.total_count} result(s)${data.incomplete_results ? ' (incomplete)' : ''}:
${items
  .map(
    (item: any) =>
      `#${item.number}: "${item.title}" (${item.state}) [${item.is_pull_request ? 'PR' : 'Issue'}]
  ${item.html_url}
  Labels: ${item.labels.length > 0 ? item.labels.join(', ') : 'none'} | Comments: ${item.comments}`
  )
  .join('\n\n')}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          total_count: data.total_count,
          incomplete_results: data.incomplete_results,
          items,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable search results' },
    metadata: {
      type: 'object',
      description: 'Search results metadata',
      properties: {
        total_count: { type: 'number', description: 'Total matching results' },
        incomplete_results: { type: 'boolean', description: 'Whether results are incomplete' },
        items: {
          type: 'array',
          description: 'Array of issues/PRs',
          items: {
            type: 'object',
            properties: {
              number: { type: 'number', description: 'Issue/PR number' },
              title: { type: 'string', description: 'Title' },
              state: { type: 'string', description: 'State (open/closed)' },
              html_url: { type: 'string', description: 'GitHub web URL' },
              user: { type: 'object', description: 'Author info' },
              labels: { type: 'array', description: 'Label names' },
              created_at: { type: 'string', description: 'Creation date' },
              updated_at: { type: 'string', description: 'Last update date' },
              comments: { type: 'number', description: 'Comment count' },
              is_pull_request: { type: 'boolean', description: 'Whether this is a PR' },
              repository_url: { type: 'string', description: 'Repository API URL' },
            },
          },
        },
      },
    },
  },
}

export const searchIssuesV2Tool: ToolConfig<SearchIssuesParams, any> = {
  id: 'github_search_issues_v2',
  name: searchIssuesTool.name,
  description: searchIssuesTool.description,
  version: '2.0.0',
  params: searchIssuesTool.params,
  request: searchIssuesTool.request,

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        total_count: data.total_count,
        incomplete_results: data.incomplete_results,
        items: data.items.map((item: any) => ({
          ...item,
          body: item.body ?? null,
          closed_at: item.closed_at ?? null,
          milestone: item.milestone ?? null,
          labels: item.labels ?? [],
          assignees: item.assignees ?? [],
        })),
      },
    }
  },

  outputs: {
    total_count: { type: 'number', description: 'Total matching results' },
    incomplete_results: { type: 'boolean', description: 'Whether results are incomplete' },
    items: {
      type: 'array',
      description: 'Array of issue/PR objects from GitHub API',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Issue ID' },
          node_id: { type: 'string', description: 'GraphQL node ID' },
          number: { type: 'number', description: 'Issue number' },
          title: { type: 'string', description: 'Title' },
          state: { type: 'string', description: 'State (open or closed)' },
          locked: { type: 'boolean', description: 'Whether issue is locked' },
          html_url: { type: 'string', description: 'Web URL' },
          url: { type: 'string', description: 'API URL' },
          repository_url: { type: 'string', description: 'Repository API URL' },
          comments_url: { type: 'string', description: 'Comments API URL' },
          body: { type: 'string', description: 'Body text', optional: true },
          comments: { type: 'number', description: 'Number of comments' },
          score: { type: 'number', description: 'Search relevance score' },
          created_at: { type: 'string', description: 'Creation timestamp' },
          updated_at: { type: 'string', description: 'Last update timestamp' },
          closed_at: { type: 'string', description: 'Close timestamp', optional: true },
          user: {
            type: 'object',
            description: 'Issue author',
            optional: true,
            properties: {
              login: { type: 'string', description: 'Username' },
              id: { type: 'number', description: 'User ID' },
              node_id: { type: 'string', description: 'GraphQL node ID' },
              avatar_url: { type: 'string', description: 'Avatar image URL' },
              url: { type: 'string', description: 'API URL' },
              html_url: { type: 'string', description: 'Profile page URL' },
              type: { type: 'string', description: 'User or Organization' },
              site_admin: { type: 'boolean', description: 'GitHub staff indicator' },
            },
          },
          labels: {
            type: 'array',
            description: 'Issue labels',
            items: {
              type: 'object',
              properties: {
                id: { type: 'number', description: 'Label ID' },
                node_id: { type: 'string', description: 'GraphQL node ID' },
                url: { type: 'string', description: 'API URL' },
                name: { type: 'string', description: 'Label name' },
                description: { type: 'string', description: 'Label description', optional: true },
                color: { type: 'string', description: 'Hex color code' },
                default: { type: 'boolean', description: 'Whether this is a default label' },
              },
            },
          },
          assignee: {
            type: 'object',
            description: 'Primary assignee',
            optional: true,
            properties: {
              login: { type: 'string', description: 'Username' },
              id: { type: 'number', description: 'User ID' },
              node_id: { type: 'string', description: 'GraphQL node ID' },
              avatar_url: { type: 'string', description: 'Avatar image URL' },
              url: { type: 'string', description: 'API URL' },
              html_url: { type: 'string', description: 'Profile page URL' },
              type: { type: 'string', description: 'User or Organization' },
              site_admin: { type: 'boolean', description: 'GitHub staff indicator' },
            },
          },
          assignees: {
            type: 'array',
            description: 'All assignees',
            items: {
              type: 'object',
              properties: {
                login: { type: 'string', description: 'Username' },
                id: { type: 'number', description: 'User ID' },
                node_id: { type: 'string', description: 'GraphQL node ID' },
                avatar_url: { type: 'string', description: 'Avatar image URL' },
                url: { type: 'string', description: 'API URL' },
                html_url: { type: 'string', description: 'Profile page URL' },
                type: { type: 'string', description: 'User or Organization' },
                site_admin: { type: 'boolean', description: 'GitHub staff indicator' },
              },
            },
          },
          milestone: {
            type: 'object',
            description: 'Associated milestone',
            optional: true,
            properties: {
              id: { type: 'number', description: 'Milestone ID' },
              node_id: { type: 'string', description: 'GraphQL node ID' },
              number: { type: 'number', description: 'Milestone number' },
              title: { type: 'string', description: 'Milestone title' },
              description: { type: 'string', description: 'Milestone description', optional: true },
              state: { type: 'string', description: 'State (open or closed)' },
              html_url: { type: 'string', description: 'Web URL' },
              due_on: { type: 'string', description: 'Due date', optional: true },
            },
          },
          pull_request: {
            type: 'object',
            description: 'Pull request details (if this is a PR)',
            optional: true,
            properties: {
              url: { type: 'string', description: 'API URL' },
              html_url: { type: 'string', description: 'Web URL' },
              diff_url: { type: 'string', description: 'Diff URL' },
              patch_url: { type: 'string', description: 'Patch URL' },
            },
          },
        },
      },
    },
  },
}
