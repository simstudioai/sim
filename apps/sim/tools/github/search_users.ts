import type { ToolConfig } from '@/tools/types'

interface SearchUsersParams {
  q: string
  sort?: 'followers' | 'repositories' | 'joined'
  order?: 'asc' | 'desc'
  per_page?: number
  page?: number
  apiKey: string
}

interface SearchUsersResponse {
  success: boolean
  output: {
    content: string
    metadata: {
      total_count: number
      incomplete_results: boolean
      items: Array<{
        id: number
        login: string
        html_url: string
        avatar_url: string
        type: string
        score: number
      }>
    }
  }
}

export const searchUsersTool: ToolConfig<SearchUsersParams, SearchUsersResponse> = {
  id: 'github_search_users',
  name: 'GitHub Search Users',
  description:
    'Search for users and organizations on GitHub. Use qualifiers like type:user, type:org, followers:>1000, repos:>10, location:city',
  version: '1.0.0',

  params: {
    q: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Search query with optional qualifiers (type:user/org, followers:, repos:, location:, language:, created:)',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort by: followers, repositories, joined (default: best match)',
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
      const url = new URL('https://api.github.com/search/users')
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
      login: item.login,
      html_url: item.html_url,
      avatar_url: item.avatar_url,
      type: item.type,
      score: item.score,
    }))

    const content = `Found ${data.total_count} user(s)/organization(s)${data.incomplete_results ? ' (incomplete)' : ''}:
${items.map((item: any) => `@${item.login} (${item.type}) - ${item.html_url}`).join('\n')}`

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
          description: 'Array of users/orgs',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number', description: 'User ID' },
              login: { type: 'string', description: 'Username' },
              html_url: { type: 'string', description: 'Profile URL' },
              avatar_url: { type: 'string', description: 'Avatar URL' },
              type: { type: 'string', description: 'User or Organization' },
              score: { type: 'number', description: 'Search relevance score' },
            },
          },
        },
      },
    },
  },
}

export const searchUsersV2Tool: ToolConfig<SearchUsersParams, any> = {
  id: 'github_search_users_v2',
  name: searchUsersTool.name,
  description: searchUsersTool.description,
  version: '2.0.0',
  params: searchUsersTool.params,
  request: searchUsersTool.request,

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        total_count: data.total_count,
        incomplete_results: data.incomplete_results,
        items: data.items,
      },
    }
  },

  outputs: {
    total_count: { type: 'number', description: 'Total matching results' },
    incomplete_results: { type: 'boolean', description: 'Whether results are incomplete' },
    items: {
      type: 'array',
      description: 'Array of user objects from GitHub API',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'User ID' },
          node_id: { type: 'string', description: 'GraphQL node ID' },
          login: { type: 'string', description: 'Username' },
          avatar_url: { type: 'string', description: 'Avatar image URL' },
          gravatar_id: { type: 'string', description: 'Gravatar ID' },
          url: { type: 'string', description: 'API URL' },
          html_url: { type: 'string', description: 'Profile page URL' },
          followers_url: { type: 'string', description: 'Followers API URL' },
          following_url: { type: 'string', description: 'Following API URL' },
          gists_url: { type: 'string', description: 'Gists API URL' },
          starred_url: { type: 'string', description: 'Starred API URL' },
          repos_url: { type: 'string', description: 'Repos API URL' },
          organizations_url: { type: 'string', description: 'Organizations API URL' },
          type: { type: 'string', description: 'User or Organization' },
          site_admin: { type: 'boolean', description: 'GitHub staff indicator' },
          score: { type: 'number', description: 'Search relevance score' },
        },
      },
    },
  },
}
