import type { ListPRsParams, PRListResponse } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const listPRsTool: ToolConfig<ListPRsParams, PRListResponse> = {
  id: 'github_list_prs',
  name: 'GitHub List Pull Requests',
  description: 'List pull requests in a GitHub repository',
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
      description: 'Filter by state: open, closed, or all',
      default: 'open',
    },
    head: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter by head user or branch name (format: user:ref-name or organization:ref-name)',
    },
    base: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by base branch name',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort by: created, updated, popularity, or long-running',
      default: 'created',
    },
    direction: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort direction: asc or desc',
      default: 'desc',
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Results per page (max 100)',
      default: 30,
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number',
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
      const url = new URL(`https://api.github.com/repos/${params.owner}/${params.repo}/pulls`)
      if (params.state) url.searchParams.append('state', params.state)
      if (params.head) url.searchParams.append('head', params.head)
      if (params.base) url.searchParams.append('base', params.base)
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
    const prs = await response.json()

    const openCount = prs.filter((pr: any) => pr.state === 'open').length
    const closedCount = prs.filter((pr: any) => pr.state === 'closed').length

    const content = `Found ${prs.length} pull request(s)
Open: ${openCount}, Closed: ${closedCount}

${prs
  .map(
    (pr: any) =>
      `#${pr.number}: ${pr.title} (${pr.state})
  URL: ${pr.html_url}`
  )
  .join('\n\n')}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          prs: prs.map((pr: any) => ({
            number: pr.number,
            title: pr.title,
            state: pr.state,
            html_url: pr.html_url,
            created_at: pr.created_at,
            updated_at: pr.updated_at,
          })),
          total_count: prs.length,
          open_count: openCount,
          closed_count: closedCount,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable list of pull requests' },
    metadata: {
      type: 'object',
      description: 'Pull requests list metadata',
      properties: {
        prs: {
          type: 'array',
          description: 'Array of pull request summaries',
        },
        total_count: { type: 'number', description: 'Total number of PRs returned' },
        open_count: { type: 'number', description: 'Number of open PRs' },
        closed_count: { type: 'number', description: 'Number of closed PRs' },
      },
    },
  },
}
