import type { ToolConfig } from '@/tools/types'

interface SearchCommitsParams {
  q: string
  sort?: 'author-date' | 'committer-date'
  order?: 'asc' | 'desc'
  per_page?: number
  page?: number
  apiKey: string
}

interface SearchCommitsResponse {
  success: boolean
  output: {
    content: string
    metadata: {
      total_count: number
      incomplete_results: boolean
      items: Array<{
        sha: string
        html_url: string
        commit: {
          message: string
          author: { name: string; email: string; date: string }
          committer: { name: string; email: string; date: string }
        }
        author: { login: string } | null
        committer: { login: string } | null
        repository: { full_name: string; html_url: string }
      }>
    }
  }
}

export const searchCommitsTool: ToolConfig<SearchCommitsParams, SearchCommitsResponse> = {
  id: 'github_search_commits',
  name: 'GitHub Search Commits',
  description:
    'Search for commits across GitHub. Use qualifiers like repo:owner/name, author:user, committer:user, author-date:>2023-01-01',
  version: '1.0.0',

  params: {
    q: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Search query with optional qualifiers (repo:, author:, committer:, author-date:, committer-date:, merge:true/false)',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort by: author-date or committer-date (default: best match)',
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
      const url = new URL('https://api.github.com/search/commits')
      url.searchParams.append('q', params.q)
      if (params.sort) url.searchParams.append('sort', params.sort)
      if (params.order) url.searchParams.append('order', params.order)
      if (params.per_page) url.searchParams.append('per_page', String(params.per_page))
      if (params.page) url.searchParams.append('page', String(params.page))
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/vnd.github.cloak-preview+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    const items = data.items.map((item: any) => ({
      sha: item.sha,
      html_url: item.html_url,
      commit: {
        message: item.commit.message,
        author: item.commit.author,
        committer: item.commit.committer,
      },
      author: item.author ? { login: item.author.login } : null,
      committer: item.committer ? { login: item.committer.login } : null,
      repository: {
        full_name: item.repository.full_name,
        html_url: item.repository.html_url,
      },
    }))

    const content = `Found ${data.total_count} commit(s)${data.incomplete_results ? ' (incomplete)' : ''}:
${items
  .map(
    (item: any) =>
      `${item.sha.substring(0, 7)} - ${item.commit.message.split('\n')[0]}
  Repository: ${item.repository.full_name}
  Author: ${item.author?.login ?? item.commit.author.name} (${item.commit.author.date})
  ${item.html_url}`
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
          description: 'Array of commits',
          items: {
            type: 'object',
            properties: {
              sha: { type: 'string', description: 'Commit SHA' },
              html_url: { type: 'string', description: 'GitHub web URL' },
              commit: {
                type: 'object',
                description: 'Commit details',
                properties: {
                  message: { type: 'string', description: 'Commit message' },
                  author: { type: 'object', description: 'Author info' },
                  committer: { type: 'object', description: 'Committer info' },
                },
              },
              author: { type: 'object', description: 'GitHub user (author)', optional: true },
              committer: { type: 'object', description: 'GitHub user (committer)', optional: true },
              repository: { type: 'object', description: 'Repository info' },
            },
          },
        },
      },
    },
  },
}

export const searchCommitsV2Tool: ToolConfig<SearchCommitsParams, any> = {
  id: 'github_search_commits_v2',
  name: searchCommitsTool.name,
  description: searchCommitsTool.description,
  version: '2.0.0',
  params: searchCommitsTool.params,
  request: searchCommitsTool.request,

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        total_count: data.total_count,
        incomplete_results: data.incomplete_results,
        items: data.items.map((item: any) => ({
          ...item,
          author: item.author ?? null,
          committer: item.committer ?? null,
        })),
      },
    }
  },

  outputs: {
    total_count: { type: 'number', description: 'Total matching results' },
    incomplete_results: { type: 'boolean', description: 'Whether results are incomplete' },
    items: {
      type: 'array',
      description: 'Array of commit objects from GitHub API',
      items: {
        type: 'object',
        properties: {
          sha: { type: 'string', description: 'Commit SHA' },
          html_url: { type: 'string', description: 'Web URL' },
          commit: { type: 'object', description: 'Commit data' },
          author: { type: 'object', description: 'GitHub user', optional: true },
          committer: { type: 'object', description: 'GitHub user', optional: true },
          repository: { type: 'object', description: 'Repository' },
        },
      },
    },
  },
}
