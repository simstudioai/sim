import {
  LICENSE_OUTPUT_PROPERTIES,
  REPO_FULL_OUTPUT_PROPERTIES,
  USER_FULL_OUTPUT_PROPERTIES,
} from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

interface SearchReposParams {
  q: string
  sort?: 'stars' | 'forks' | 'help-wanted-issues' | 'updated'
  order?: 'asc' | 'desc'
  per_page?: number
  page?: number
  apiKey: string
}

interface SearchReposResponse {
  success: boolean
  output: {
    content: string
    metadata: {
      total_count: number
      incomplete_results: boolean
      items: Array<{
        id: number
        full_name: string
        description: string | null
        html_url: string
        stargazers_count: number
        forks_count: number
        language: string | null
        topics: string[]
        created_at: string
        updated_at: string
        owner: { login: string }
      }>
    }
  }
}

export const searchReposTool: ToolConfig<SearchReposParams, SearchReposResponse> = {
  id: 'github_search_repos',
  name: 'GitHub Search Repositories',
  description:
    'Search for repositories across GitHub. Use qualifiers like language:python, stars:>1000, topic:react, user:owner, org:name',
  version: '1.0.0',

  params: {
    q: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Search query with optional qualifiers (language:, stars:, forks:, topic:, user:, org:, in:name,description,readme)',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort by: stars, forks, help-wanted-issues, updated (default: best match)',
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
      const url = new URL('https://api.github.com/search/repositories')
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
      id: item.id,
      full_name: item.full_name,
      description: item.description ?? null,
      html_url: item.html_url,
      stargazers_count: item.stargazers_count,
      forks_count: item.forks_count,
      language: item.language ?? null,
      topics: item.topics ?? [],
      created_at: item.created_at,
      updated_at: item.updated_at,
      owner: { login: item.owner?.login ?? 'unknown' },
    }))

    const content = `Found ${data.total_count} repository(s)${data.incomplete_results ? ' (incomplete)' : ''}:
${items
  .map(
    (item: any) =>
      `${item.full_name} ⭐ ${item.stargazers_count} | 🍴 ${item.forks_count}
  ${item.description ?? 'No description'}
  ${item.html_url}
  Language: ${item.language ?? 'N/A'} | Topics: ${item.topics.length > 0 ? item.topics.join(', ') : 'none'}`
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
          description: 'Array of repositories',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number', description: 'Repository ID' },
              full_name: { type: 'string', description: 'Full name (owner/repo)' },
              description: { type: 'string', description: 'Description', optional: true },
              html_url: { type: 'string', description: 'GitHub web URL' },
              stargazers_count: { type: 'number', description: 'Star count' },
              forks_count: { type: 'number', description: 'Fork count' },
              language: { type: 'string', description: 'Primary language', optional: true },
              topics: { type: 'array', description: 'Repository topics' },
              created_at: { type: 'string', description: 'Creation date' },
              updated_at: { type: 'string', description: 'Last update date' },
              owner: { type: 'object', description: 'Owner info' },
            },
          },
        },
      },
    },
  },
}

export const searchReposV2Tool: ToolConfig<SearchReposParams, any> = {
  id: 'github_search_repos_v2',
  name: searchReposTool.name,
  description: searchReposTool.description,
  version: '2.0.0',
  params: searchReposTool.params,
  request: searchReposTool.request,

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        total_count: data.total_count,
        incomplete_results: data.incomplete_results,
        items: data.items.map((item: any) => ({
          ...item,
          description: item.description ?? null,
          language: item.language ?? null,
          topics: item.topics ?? [],
          license: item.license ?? null,
        })),
      },
    }
  },

  outputs: {
    total_count: { type: 'number', description: 'Total matching results' },
    incomplete_results: { type: 'boolean', description: 'Whether results are incomplete' },
    items: {
      type: 'array',
      description: 'Array of repository objects from GitHub API',
      items: {
        type: 'object',
        properties: {
          ...REPO_FULL_OUTPUT_PROPERTIES,
          score: { type: 'number', description: 'Search relevance score' },
          topics: { type: 'array', description: 'Repository topics' },
          license: {
            type: 'object',
            description: 'License information',
            optional: true,
            properties: LICENSE_OUTPUT_PROPERTIES,
          },
          owner: {
            type: 'object',
            description: 'Repository owner',
            properties: USER_FULL_OUTPUT_PROPERTIES,
          },
        },
      },
    },
  },
}
